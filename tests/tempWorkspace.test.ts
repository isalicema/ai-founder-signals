import { access, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { withTempWorkspace } from '../src/worker/tempWorkspace.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('withTempWorkspace', () => {
  it('removes raw files after a successful job', async () => {
    let captured = '';
    const result = await withTempWorkspace(async (directory) => {
      captured = directory;
      await writeFile(`${directory}/raw.txt`, 'ephemeral interview body', 'utf8');
      expect(await exists(`${directory}/raw.txt`)).toBe(true);
      return { contentChars: 24 };
    });

    expect(result).toEqual({ contentChars: 24 });
    expect(await exists(captured)).toBe(false);
  });

  it('removes raw files when processing throws', async () => {
    let captured = '';
    await expect(
      withTempWorkspace(async (directory) => {
        captured = directory;
        await writeFile(`${directory}/raw.txt`, 'ephemeral interview body', 'utf8');
        throw new Error('summarizer failed');
      }),
    ).rejects.toThrow('summarizer failed');

    expect(await exists(captured)).toBe(false);
  });
});
