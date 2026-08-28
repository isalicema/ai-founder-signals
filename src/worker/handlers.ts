import type { Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import type { AfsDatabase } from '../db/client.js';
import { items, sources, type NewItem } from '../db/schema.js';
import { createDefaultAdapterRegistry, type AdapterRegistry } from '../adapters/registry.js';
import { canonicalizeUrl } from '../adapters/url.js';
import { FetchBlockedError, AdapterError } from '../adapters/errors.js';
import type { DiscoveredItem } from '../adapters/types.js';
import { admit } from '../pipeline/admission/index.js';
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
): Promise<{ found: number; enqueued: number }> {
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

  const seen = await existingExternalIds(ctx.db, source.id, found.map((i) => i.externalId));
  const fresh = found.filter((i) => !seen.has(i.externalId));

  for (const item of fresh) {
    await ctx.sql`
      insert into public.job (kind, payload, idempotency_key)
      values ('process', ${ctx.sql.json({ sourceId: source.id, item: serializeItem(item) } as never)}, ${`process:${source.id}:${item.externalId}`})
      on conflict (idempotency_key) do nothing
    `;
  }
  return { found: found.length, enqueued: fresh.length };
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
      analyzeInWorkspace(adapter, item, source.name, workspace, ctx.ledger));
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
  const tier = scoreTier({
    sourceWeight: normalizeSourceWeight(source.weight),
    titleSignal: admission.titleSignalScore,
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
