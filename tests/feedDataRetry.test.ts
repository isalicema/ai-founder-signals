import { describe, expect, it, vi } from 'vitest';
import { withFeedReadRetry } from '../src/feed/data.js';

describe('feed database read retry', () => {
  it('resets the shared connection and returns the second read', async () => {
    const error = Object.assign(new Error('connection timed out'), { code: 'CONNECT_TIMEOUT' });
    const read = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('database');
    const reset = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await expect(withFeedReadRetry(read, {
      reset,
      wait,
      log,
      now: () => new Date('2026-10-19T08:00:00.000Z'),
    })).resolves.toBe('database');

    expect(read).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(300);
    expect(log).toHaveBeenCalledWith({
      event: 'afs.feed.database_read_failed',
      at: '2026-10-19T08:00:00.000Z',
      attempt: 1,
      query: 'shared_connection',
      code: 'CONNECT_TIMEOUT',
      message: 'connection timed out',
      retrying: true,
    });
  });

  it('logs both failures and rethrows after one retry', async () => {
    const first = Object.assign(new Error('socket closed'), { code: 'CONNECTION_CLOSED' });
    const second = Object.assign(new Error('read timed out'), { code: 'CONNECT_TIMEOUT' });
    const read = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);
    const log = vi.fn();

    await expect(withFeedReadRetry(read, {
      reset: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      log,
      now: () => new Date('2026-10-19T08:00:00.000Z'),
    })).rejects.toBe(second);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      attempt: 2,
      query: 'shared_connection',
      code: 'CONNECT_TIMEOUT',
      message: 'read timed out',
      retrying: false,
    });
  });

  it('continues to the second read when resetting the stale pool fails', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('first read failed'))
      .mockResolvedValueOnce('database');
    const log = vi.fn();

    await expect(withFeedReadRetry(read, {
      reset: vi.fn().mockRejectedValue(new Error('close failed')),
      wait: vi.fn().mockResolvedValue(undefined),
      log,
      now: () => new Date('2026-10-19T08:00:00.000Z'),
    })).resolves.toBe('database');

    expect(read).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      query: 'shared_connection_reset',
      message: 'close failed',
      retrying: true,
    });
  });
});
