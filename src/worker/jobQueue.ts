import type { Sql } from 'postgres';
import type { JobKind, JobPayload, JobStatus } from './types.js';

interface RawJobRow {
  id: string | number;
  kind: JobKind;
  payload: JobPayload;
  idempotency_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  last_error: string | null;
}

export interface ClaimedJob {
  id: number;
  kind: JobKind;
  payload: JobPayload;
  idempotencyKey: string | null;
  status: 'running';
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
}

export interface FailedJobUpdate {
  id: number;
  status: 'queued' | 'failed';
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string;
}

export class JobStateError extends Error {
  constructor(action: 'complete' | 'fail', jobId: number) {
    super(`Cannot ${action} job ${jobId}: it does not exist or is not running`);
    this.name = 'JobStateError';
  }
}

export interface JobFailure {
  /** Safe classifier only, for example `network_timeout`; never include raw content. */
  code: string;
}

const CLAIM_JOB_SQL = `
with candidate as (
  select id
  from public.job
  where status = 'queued'
    and run_after <= now()
    and attempts < max_attempts
  order by run_after, id
  limit 1
  for update skip locked
)
update public.job as job
set status = 'running',
    attempts = job.attempts + 1,
    last_error = null
from candidate
where job.id = candidate.id
returning job.id, job.kind, job.payload, job.idempotency_key, job.status,
          job.attempts, job.max_attempts, job.run_after, job.last_error
`;

const COMPLETE_JOB_SQL = `
update public.job
set status = 'completed', last_error = null
where id = $1 and status = 'running'
returning id
`;

const FAIL_JOB_SQL = `
update public.job
set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    run_after = case
      when attempts >= max_attempts then run_after
      else now() + interval '1 minute' * power(3, attempts)
    end,
    last_error = $2
where id = $1 and status = 'running'
returning id, status, attempts, max_attempts, run_after, last_error
`;

function mapClaimedJob(row: RawJobRow): ClaimedJob {
  const id = safeJobId(row.id);
  if (row.status !== 'running') throw new Error(`Claimed job ${id} has unexpected status ${row.status}`);
  return {
    id,
    kind: row.kind,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lastError: row.last_error,
  };
}

/** Atomically claims one runnable job. Concurrent workers skip locked rows. */
export function claimJob(sql: Sql): Promise<ClaimedJob | null> {
  return sql.begin(async (transaction) => {
    const rows = await transaction.unsafe<RawJobRow[]>(CLAIM_JOB_SQL);
    const row = rows[0];
    return row ? mapClaimedJob(row) : null;
  });
}

/** Completes a running job and rejects stale/double completion. */
export async function completeJob(sql: Sql, jobId: number): Promise<void> {
  const rows = await sql.unsafe<Array<{ id: number }>>(COMPLETE_JOB_SQL, [jobId]);
  if (rows.length === 0) throw new JobStateError('complete', jobId);
}

/**
 * Requeues a running job with 3^attempt minute backoff, or marks it failed
 * once max_attempts has been reached. Only a safe classifier is stored; raw
 * content and arbitrary exception messages cannot cross into the database.
 */
export async function failJob(sql: Sql, jobId: number, failure: JobFailure): Promise<FailedJobUpdate> {
  const message = failureCode(failure);
  const rows = await sql.unsafe<
    Array<{
      id: string | number;
      status: 'queued' | 'failed';
      attempts: number;
      max_attempts: number;
      run_after: Date;
      last_error: string;
    }>
  >(FAIL_JOB_SQL, [jobId, message]);
  const row = rows[0];
  if (!row) throw new JobStateError('fail', jobId);
  return {
    id: safeJobId(row.id),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lastError: row.last_error,
  };
}

export function failureCode(failure: JobFailure): string {
  const normalized = failure.code.trim().slice(0, 120);
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(normalized) ? normalized : 'unclassified_error';
}

function safeJobId(value: string | number): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Unsafe job id: ${String(value)}`);
  return id;
}
