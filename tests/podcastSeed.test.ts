import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../src/db/seed/sources.js';

describe('Podcast source seed', () => {
  it('keeps 42章经 enabled on its canonical Xiaoyuzhou show page', () => {
    const source = SEED_SOURCES.find((candidate) => candidate.name === '42章经');

    expect(source).toMatchObject({
      url: 'https://www.xiaoyuzhoufm.com/podcast/648b0b641c48983391a63f98',
      country: 'CN',
      language: 'zh',
      ingestMethod: 'podcast',
      fetchMode: 'full',
      purity: 0.6,
    });
    expect(source?.enabled).not.toBe(false);
  });
});
