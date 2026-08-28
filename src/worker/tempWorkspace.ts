import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMP_PREFIX = 'afs-worker-';

/**
 * Owns the complete lifecycle of raw article/transcript files.
 *
 * Business code receives a temporary directory but never controls cleanup.
 * Cleanup runs on success, failure, and cancellation paths; a cleanup failure
 * is surfaced instead of being silently logged and ignored.
 */
export async function withTempWorkspace<Result>(
  run: (directory: string) => Promise<Result>,
): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  try {
    return await run(directory);
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
