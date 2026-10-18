import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toolsDirectory = fileURLToPath(new URL('../tools', import.meta.url));
const envLoadingTools = readdirSync(toolsDirectory)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, source: readFileSync(join(toolsDirectory, name), 'utf8') }))
  .filter(({ source }) => source.includes('loadEnvFile'));
const expectedEnvLoadingTools = [
  'archiveFetch.ts',
  'archiveQueue.ts',
  'dbCheck.ts',
  'seed.ts',
  'smokeLlm.ts',
  'worker.ts',
];

describe('tool environment loading', () => {
  it('covers every public tool that loads .env.local', () => {
    expect(envLoadingTools.map(({ name }) => name).sort()).toEqual(expectedEnvLoadingTools);
  });

  it.each(envLoadingTools)('$name decodes file URLs before opening .env.local', ({ source }) => {
    expect(source).toContain('fileURLToPath');
    expect(source).not.toMatch(/new URL\([^\n]+import\.meta\.url\)\.pathname/);
  });
});
