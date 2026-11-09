import { describe, expect, it, vi } from 'vitest';
import { handleDiscover, type HandlerContext } from '../src/worker/handlers.js';
import { UsageLedger } from '../src/llm/provider.js';

const source = {
  id: 's1',
  lastCheckedAt: new Date('2026-11-01'),
  consecutiveFailures: 2,
};

function setup(failDiscover = false, failEnqueueAt?: number) {
  const updates: Record<string, unknown>[] = [];
  const events: string[] = [];
  let enqueueCount = 0;
  const ctx = {
    db: {
      select: (columns?: unknown) => ({
        from: () => ({ where: async () => (columns ? [] : [source]) }),
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            updates.push(value);
            events.push('update');
          },
        }),
      }),
    },
    sql: vi.fn(async () => {
      events.push('enqueue');
      enqueueCount += 1;
      if (enqueueCount === failEnqueueAt) throw Error('enqueue');
      return [];
    }),
    registry: {
      forSource: () => ({
        discover: async () => {
          if (failDiscover) throw Error('discovery');
          return ['v1', 'v2'].map((externalId) => ({
            externalId,
            title: `test ${externalId}`,
            url: `https://example.com/${externalId}`,
            mediaType: 'video' as const,
            publishedAt: new Date(),
          }));
        },
      }),
    },
    ledger: new UsageLedger(),
  } as unknown as HandlerContext;
  return { ctx, updates, events };
}

describe('discovery watermark', () => {
  it('retains old cutoff when discovery fails', async () => {
    const candidate = setup(true);
    await expect(handleDiscover(candidate.ctx, { sourceId: 's1' })).rejects.toThrow('discovery');
    expect(candidate.updates).toEqual([{ consecutiveFailures: 3 }]);
  });

  it('retains old cutoff if enqueue fails', async () => {
    const candidate = setup(false, 2);
    await expect(handleDiscover(candidate.ctx, { sourceId: 's1' })).rejects.toThrow('enqueue');
    expect(candidate.events).toEqual(['enqueue', 'enqueue']);
    expect(candidate.updates).toEqual([]);
  });

  it('advances only after successful enqueue', async () => {
    const candidate = setup();
    await handleDiscover(candidate.ctx, { sourceId: 's1' });
    expect(candidate.events).toEqual(['enqueue', 'enqueue', 'update']);
    expect(candidate.updates[0]).toMatchObject({
      lastCheckedAt: expect.any(Date),
      consecutiveFailures: 0,
    });
  });
});
