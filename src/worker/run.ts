import { eq } from 'drizzle-orm';
import type { AfsDatabase } from '../db/client.js';
import type { Sql } from 'postgres';
import { sources } from '../db/schema.js';
import { claimJob, completeJob, failJob, failureCode } from './jobQueue.js';
import { createContext, handleDiscover, handleProcess, type HandlerContext } from './handlers.js';
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

/**
 * 为每个启用的信源排一个当日 discover 任务。
 * idempotency_key 带日期 → 同一天重复调用不会产生重复任务。
 */
export async function enqueueDailyDiscover(db: AfsDatabase, sql: Sql, day = today()): Promise<number> {
  const enabled = await db.select({ id: sources.id }).from(sources).where(eq(sources.enabled, true));
  let queued = 0;
  for (const source of enabled) {
    const rows = await sql`
      insert into public.job (kind, payload, idempotency_key)
      values ('discover', ${sql.json({ sourceId: source.id } as never)}, ${`discover:${source.id}:${day}`})
      on conflict (idempotency_key) do nothing
      returning id
    `;
    if (rows.length > 0) queued += 1;
  }
  return queued;
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
    return `discover:+${result.enqueued}/${result.found}`;
  }
  if (kind === 'process') {
    const result = await handleProcess(ctx, payload as never);
    return result.outcome;
  }
  if (kind === 'rescore') {
    // M9/M10。⚠️ 实现前必须先解决「反馈会被 rescore 洗掉」——见 docs/HANDOFF.md
    throw new AdapterError('unsupported_ingest_method', { retryable: false });
  }
  throw new AdapterError('unsupported_ingest_method', { retryable: false });
}

/** 异常 → 安全分类码。绝不泄漏异常消息本身。 */
export function classify(error: unknown): string {
  if (error instanceof AdapterError) return failureCode({ code: error.code });
  if (error instanceof Error && /timeout|abort/i.test(error.name)) return 'timeout';
  return 'unclassified_error';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
