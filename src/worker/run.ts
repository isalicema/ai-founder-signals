import { eq } from 'drizzle-orm';
import type { AfsDatabase } from '../db/client.js';
import type { Sql } from 'postgres';
import { sources } from '../db/schema.js';
import { claimJob, completeJob, failJob, failureCode } from './jobQueue.js';
import { createContext, handleDiscover, handleProcess, type HandlerContext } from './handlers.js';
import { createDefaultAdapterRegistry } from '../adapters/registry.js';
import { AdapterError } from '../adapters/errors.js';
import { UsageLedger } from '../llm/provider.js';

export interface RunOptions {
  /** 单次运行最多处理多少个任务，防止 Actions 跑太久 */
  maxJobs?: number;
  /** 墙钟上限（毫秒）。到点就停，剩下的任务留给下一轮——队列本身是持久的 */
  budgetMs?: number;
}

export interface RunReport {
  claimed: number;
  completed: number;
  failed: number;
  outcomes: Record<string, number>;
  usage: string;
  stoppedBy: 'drained' | 'max_jobs' | 'budget';
}

export interface EnqueueReport {
  queued: number;
  /** 启用了但当前没有对应适配器的信源（例如 html 在 HtmlAdapter 落地之前） */
  skipped: string[];
}

/**
 * 为每个启用**且有适配器可用**的信源排一个当日 discover 任务。
 * idempotency_key 带日期 → 同一天重复调用不会产生重复任务。
 *
 * ⚠️ 明知跑不通就不排队。否则每天会白排一批必失败的任务，
 *    把 consecutive_failures 刷高、在运维面板里制造假故障。
 *    等适配器落地，这些信源会自动恢复排班，不需要改数据。
 */
export async function enqueueDailyDiscover(
  db: AfsDatabase, sql: Sql, day = today(),
): Promise<EnqueueReport> {
  const enabled = await db.select().from(sources).where(eq(sources.enabled, true));
  const registry = createDefaultAdapterRegistry();
  const skipped: string[] = [];
  let queued = 0;
  for (const source of enabled) {
    try {
      registry.forSource(source);
    } catch {
      skipped.push(`${source.name}(${source.ingestMethod})`);
      continue;
    }
    const rows = await sql`
      insert into public.job (kind, payload, idempotency_key)
      values ('discover', ${JSON.stringify({ sourceId: source.id })}::jsonb, ${`discover:${source.id}:${day}`})
      on conflict (idempotency_key) do nothing
      returning id
    `;
    if (rows.length > 0) queued += 1;
  }
  return { queued, skipped };
}

/**
 * 认领循环。一次运行处理到队列排空、或到达任务数/时间上限为止。
 *
 * ⚠️ 任何一个任务失败都不会中断整轮——失败任务按 3^attempt 分钟退避重排，
 *    超过 max_attempts 才转 failed，在运维面板里一键重置（架构文档 §5.3）。
 */
export async function runWorker(
  db: AfsDatabase,
  sql: Sql,
  options: RunOptions = {},
): Promise<RunReport> {
  const maxJobs = options.maxJobs ?? 200;
  const budgetMs = options.budgetMs ?? 20 * 60 * 1000;
  const startedAt = Date.now();
  const ledger = new UsageLedger();
  const ctx = createContext(db, sql, ledger);

  const report: RunReport = {
    claimed: 0, completed: 0, failed: 0, outcomes: {}, usage: '', stoppedBy: 'drained',
  };

  while (true) {
    if (report.claimed >= maxJobs) { report.stoppedBy = 'max_jobs'; break; }
    if (Date.now() - startedAt > budgetMs) { report.stoppedBy = 'budget'; break; }

    const job = await claimJob(sql);
    if (!job) break;
    report.claimed += 1;

    try {
      const outcome = await dispatch(ctx, job.kind, job.payload);
      await completeJob(sql, job.id);
      report.completed += 1;
      report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1;
    } catch (error) {
      // ⚠️ 只把安全分类码写进库，绝不写异常原文——它可能带正文片段
      const update = await failJob(sql, job.id, { code: classify(error) });
      if (update.status === 'failed') report.failed += 1;
      report.outcomes[`error:${classify(error)}`] =
        (report.outcomes[`error:${classify(error)}`] ?? 0) + 1;
    }
  }

  report.usage = ledger.summary();
  return report;
}

async function dispatch(ctx: HandlerContext, kind: string, payload: unknown): Promise<string> {
  if (kind === 'discover') {
    const result = await handleDiscover(ctx, payload as { sourceId: string });
    const aged = result.tooOld > 0 ? `,过期${result.tooOld}` : '';
    return `discover:+${result.enqueued}/${result.found}${aged}`;
  }
  if (kind === 'process') {
    const result = await handleProcess(ctx, payload as never);
    return result.outcome;
  }
  // ⚠️ 没有 rescore。反馈不调权（用户看完首批 50 条后的决定，见 PROJECT.md §4.11），
  //    所以没有任何东西会重算已有条目的 tier——手动点的高亮/折叠永远不会被覆盖。
  throw new AdapterError('unsupported_ingest_method', { retryable: false });
}

/**
 * 异常 → 安全分类码。绝不泄漏异常消息本身。
 *
 * ⚠️ 但也不能一律记成 unclassified_error——实测排查一个真实故障时，
 *    那个码什么都没告诉我。Postgres 的 SQLSTATE 是**结构化错误码、不含数据**，
 *    记下来既安全又能直接定位（22003=数值越界、23505=唯一键冲突、23514=检查约束）。
 */
export function classify(error: unknown): string {
  if (error instanceof AdapterError) return failureCode({ code: error.code });
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `db_${code}`;
  // 我们自己定义的管线错误码（如 summarize_parse_failed）——是代码常量不是用户内容，
  // 记下来安全且可定位。实测排查时 unclassified_error 什么都没告诉我。
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{2,}$/.test(code)) return failureCode({ code });
  if (error instanceof Error && /timeout|abort/i.test(error.name)) return 'timeout';
  return 'unclassified_error';
}

/**
 * 排队幂等键用的「今天」——**必须是北京时间的日期**。
 *
 * ⚠️ 2026-09-05 踩过：原本写 `new Date().toISOString()`，那是 UTC 日期。
 *    而 launchd 在**北京时间 06:00** 调起 worker，此刻 UTC 还是前一天 22:00，
 *    于是每天早晨的定时跑，用的都是「昨天」的键。
 *
 *    后果不是当天报错，而是**静默空跑**：任何在北京白天（08:00 之后）
 *    跑过的手动运行，都会把次日 06:00 的键提前占掉，第二天早上
 *    `已排 0 个 discover 任务 · 认领 0 · 退出码 0` —— 一切看起来都正常，
 *    只是 feed 里没有新信号。实测就是这么发现的（Alice 问「怎么没新信号」）。
 *
 *    中国大陆无夏令时，固定 +8 即可，不必引 Intl 依赖。
 */
export function today(): string {
  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}
