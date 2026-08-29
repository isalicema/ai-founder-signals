import type { Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import type { AfsDatabase } from '../db/client.js';
import { items, sources, type NewItem } from '../db/schema.js';
import { createDefaultAdapterRegistry, type AdapterRegistry } from '../adapters/registry.js';
import { canonicalizeUrl } from '../adapters/url.js';
import { FetchBlockedError, AdapterError } from '../adapters/errors.js';
import type { DiscoveredItem } from '../adapters/types.js';
import { admit, evaluateStructural } from '../pipeline/admission/index.js';
import { scoreTier, normalizeSourceWeight } from '../pipeline/tier/index.js';
import { createLlmJudge } from '../llm/judge.js';
import type { UsageLedger } from '../llm/provider.js';
import { withTempWorkspace } from './tempWorkspace.js';
import { analyzeInWorkspace } from './analyze.js';
import { upsertEntities, findNearDuplicate, existingExternalIds } from './persist.js';

export interface HandlerContext {
  db: AfsDatabase;
  sql: Sql;
  registry: AdapterRegistry;
  ledger: UsageLedger;
}

export function createContext(db: AfsDatabase, sql: Sql, ledger: UsageLedger): HandlerContext {
  return { db, sql, registry: createDefaultAdapterRegistry(), ledger };
}

/* ────────────────────────── discover ────────────────────────── */

/**
 * 拉一个信源的列表，为每条没见过的内容排一个 process 任务。
 *
 * ⚠️ discover 只做发现，不抓正文、不调 LLM。判定发生在 process 里，
 *    而判定又在抓正文之前——被判 folded 的条目全程不下载正文（§4.1）。
 */
export async function handleDiscover(
  ctx: HandlerContext,
  payload: { sourceId: string },
): Promise<{ found: number; enqueued: number; tooOld: number }> {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, payload.sourceId));
  if (!source) throw new AdapterError('unsupported_ingest_method', { retryable: false });

  const adapter = ctx.registry.forSource(source);
  let found: DiscoveredItem[];
  try {
    found = await adapter.discover(source);
    await ctx.db.update(sources)
      .set({ lastCheckedAt: new Date(), consecutiveFailures: 0 })
      .where(eq(sources.id, source.id));
  } catch (error) {
    await ctx.db.update(sources)
      .set({ lastCheckedAt: new Date(), consecutiveFailures: source.consecutiveFailures + 1 })
      .where(eq(sources.id, source.id));
    throw error;
  }

  // ⚠️ 信源固定返回「最近 15 条」，不管这 15 条跨多久。实测首轮 165 条里
  //    62 条超过 30 天、最早回溯到四个月前。
  //
  //    Alice 的用法是「只看今天」，所以窗口不是固定回溯 N 天，而是
  //    **上次检查之后的新内容**——这才是「每天打开看新增」的准确表达。
  //    首次检查该信源时没有上次时间可用，退回一个很窄的初始窗口。
  //
  //    没有日期的条目放行（HtmlAdapter 拿不到发布时间，见其 spec §2.4——
  //    那边宁可留 null 也不猜日期，这边就不能因为 null 把它们全丢掉）。
  const cutoff = discoveryCutoff(source.lastCheckedAt);
  const recent = found.filter((i) => !i.publishedAt || i.publishedAt.getTime() >= cutoff.getTime());
  const tooOld = found.length - recent.length;

  const seen = await existingExternalIds(ctx.db, source.id, recent.map((i) => i.externalId));
  const fresh = recent.filter((i) => !seen.has(i.externalId));

  for (const item of fresh) {
    await ctx.sql`
      insert into public.job (kind, payload, idempotency_key)
      values ('process', ${JSON.stringify({ sourceId: source.id, item: serializeItem(item) })}::jsonb, ${`process:${source.id}:${item.externalId}`})
      on conflict (idempotency_key) do nothing
    `;
  }
  return { found: found.length, enqueued: fresh.length, tooOld };
}

/** 首次检查某信源时的初始窗口，默认 1 天——只要「今天」。 */
export function firstRunWindowDays(): number {
  const raw = Number(process.env.AFS_FIRST_RUN_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * 回看重叠。cron 抖动、信源延迟发布、时区边界都可能让内容「迟到」，
 * 窗口卡死在上次检查时刻会漏掉它们。重叠部分由 external_id 去重兜住，
 * 不会重复处理，所以这里可以放宽一点。
 */
const OVERLAP_MS = 12 * 60 * 60 * 1000;

export function discoveryCutoff(lastCheckedAt: Date | null, now = new Date()): Date {
  if (lastCheckedAt) return new Date(lastCheckedAt.getTime() - OVERLAP_MS);
  return new Date(now.getTime() - firstRunWindowDays() * 24 * 60 * 60 * 1000);
}

/* ────────────────────────── process ────────────────────────── */

export async function handleProcess(
  ctx: HandlerContext,
  payload: { sourceId: string; item: SerializedItem },
): Promise<{ outcome: 'folded' | 'accepted' | 'duplicate' | 'needs_body' }> {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, payload.sourceId));
  if (!source) throw new AdapterError('unsupported_ingest_method', { retryable: false });

  const item = deserializeItem(payload.item);
  const adapter = ctx.registry.forSource(source);

  const admission = await admit(
    {
      title: item.title,
      snippet: item.admissionSnippet ?? '',
      mediaType: item.mediaType,
      durationSeconds: item.durationSeconds ?? null,
      contentChars: null,
      source: { purity: source.purity, name: source.name },
    },
    createLlmJudge(ctx.ledger),
  );

  const base: NewItem = {
    sourceId: source.id,
    url: item.url,
    urlCanonical: canonicalizeUrl(item.url),
    externalId: item.externalId,
    title: item.title,
    mediaType: item.mediaType,
    publishedAt: item.publishedAt,
    durationSeconds: item.durationSeconds ?? null,
    coverUrl: item.coverUrl ?? null,
    admissionConfidence: admission.admissionConfidence,
    isFounderInterview: admission.accepted,
    status: 'ok',
  };

  // ⚠️ 被拒的仍然入库，只是不下载正文、不生成摘要。永不丢弃，只降权（§4.4）
  if (!admission.shouldFetchBody) {
    const tier = scoreTier({
      sourceWeight: normalizeSourceWeight(source.weight),
      titleSignal: admission.titleSignalScore,
      admissionConfidence: admission.admissionConfidence,
      entityStarred: false,
    });
    await insert(ctx, { ...base, tier: 'folded', tierScore: tier.score, tierReason: tier.reason,
      rejectReason: admission.rejectReason ?? 'admission_rejected' });
    return { outcome: 'folded' };
  }

  let analysis;
  try {
    analysis = await withTempWorkspace((workspace) =>
      analyzeInWorkspace(adapter, item, source, workspace, ctx.ledger));
  } catch (error) {
    // 抓不到正文是支持的降级，不是数据丢失——仍然入库，标注状态（§5.1）
    if (error instanceof FetchBlockedError) {
      await insert(ctx, { ...base, status: 'needs_body', tier: 'feed',
        rejectReason: error.code });
      return { outcome: 'needs_body' };
    }
    throw error;
  }

  if (analysis.simhash !== undefined) {
    const duplicate = await findNearDuplicate(ctx.db, analysis.simhash, item.publishedAt);
    if (duplicate) return { outcome: 'duplicate' };   // 纯转载，跳过（§6.1 L2）
  }

  const persons = await upsertEntities(ctx.db, 'person', analysis.persons);
  const companies = await upsertEntities(ctx.db, 'company', analysis.companies);

  // ⚠️ 实测发现的漏洞：YouTube RSS **不提供时长**，所以准入阶段的结构性降权
  //    （短视频/短文 ×0.6）对 YouTube 从来没生效过——Lex、Kantrowitz 这类频道
  //    大量发布正片切片（Clips），会当正片进 feed。
  //    抓完正文才知道真实长度，这里用真实 contentChars 补算一次。
  const structural = evaluateStructural({
    mediaType: item.mediaType,
    durationSeconds: item.durationSeconds ?? null,
    contentChars: analysis.contentChars ?? null,
  });

  const tier = scoreTier({
    sourceWeight: normalizeSourceWeight(source.weight),
    titleSignal: +(admission.titleSignalScore * structural.factor).toFixed(4),
    admissionConfidence: admission.admissionConfidence,
    entityStarred: persons.anyStarred || companies.anyStarred,
  });

  await insert(ctx, {
    ...base,
    summary: analysis.summary,
    tags: analysis.tags,
    persons: persons.canonical,
    companies: companies.canonical,
    contentChars: analysis.contentChars ?? null,
    simhash: analysis.simhash ?? null,
    modelVersion: analysis.modelVersion,
    tier: tier.tier,
    tierScore: tier.score,
    tierReason: tier.reason,
  });
  return { outcome: 'accepted' };
}

async function insert(ctx: HandlerContext, row: NewItem): Promise<void> {
  await ctx.db.insert(items).values(row).onConflictDoNothing();
}

/* ───────────────────── 任务载荷序列化 ───────────────────── */

export interface SerializedItem {
  externalId: string; url: string; title: string; publishedAt: string | null;
  coverUrl?: string; durationSeconds?: number;
  mediaType: 'article' | 'video' | 'podcast'; admissionSnippet?: string; languageHint?: string;
}

export function serializeItem(item: DiscoveredItem): SerializedItem {
  return { ...item, publishedAt: item.publishedAt?.toISOString() ?? null };
}

export function deserializeItem(raw: SerializedItem): DiscoveredItem {
  return { ...raw, publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null };
}
