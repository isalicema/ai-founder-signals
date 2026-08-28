import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { claimJob, completeJob, failJob, failureCode, JobStateError } from '../src/worker/jobQueue.js';

function fakeSql(responses: unknown[][]): { sql: Sql; unsafe: ReturnType<typeof vi.fn> } {
  const unsafe = vi.fn(async () => responses.shift() ?? []);
  const transaction = { unsafe };
  const sql = {
    unsafe,
    begin: async (run: (value: typeof transaction) => Promise<unknown>) => run(transaction),
  } as unknown as Sql;
  return { sql, unsafe };
}

describe('job queue', () => {
  it('claims with SKIP LOCKED and maps the database row', async () => {
    const { sql, unsafe } = fakeSql([
      [
        {
          id: '7',
          kind: 'process',
          payload: { itemId: 'abc' },
          idempotency_key: 'process:abc',
          status: 'running',
          attempts: 1,
          max_attempts: 3,
          run_after: new Date('2026-08-29T06:00:00Z'),
          last_error: null,
        },
      ],
    ]);

    await expect(claimJob(sql)).resolves.toMatchObject({
      id: 7,
      status: 'running',
      idempotencyKey: 'process:abc',
      attempts: 1,
    });
    expect(String(unsafe.mock.calls[0]?.[0])).toContain('for update skip locked');
  });

  it('returns null when there is no runnable job', async () => {
    const { sql } = fakeSql([[]]);
    await expect(claimJob(sql)).resolves.toBeNull();
  });

  it('rejects a stale completion', async () => {
    const { sql } = fakeSql([[]]);
    await expect(completeJob(sql, 19)).rejects.toEqual(new JobStateError('complete', 19));
  });

  it('returns the requeue or terminal failure state', async () => {
    const { sql, unsafe } = fakeSql([
      [
        {
          id: '8',
          status: 'queued',
          attempts: 1,
          max_attempts: 3,
          run_after: new Date('2026-08-29T06:03:00Z'),
          last_error: 'network_failed',
        },
      ],
    ]);

    await expect(failJob(sql, 8, { code: 'network_failed' })).resolves.toMatchObject({
      id: 8,
      status: 'queued',
      maxAttempts: 3,
    });
    expect(String(unsafe.mock.calls[0]?.[0])).toContain("power(3, attempts)");
  });

  it('bounds stored errors without serializing arbitrary objects', () => {
    expect(failureCode({ code: 'network_timeout' })).toBe('network_timeout');
    expect(failureCode({ code: 'raw body: secret words' })).toBe('unclassified_error');
  });
});
