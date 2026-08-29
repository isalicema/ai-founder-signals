import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../src/db/seed/sources.js';

describe('JSON API source seeds', () => {
  it('keeps exactly three configured JSON API sources enabled', () => {
    const sources = SEED_SOURCES.filter((source) => source.ingestMethod === 'json_api');
    expect(sources).toHaveLength(3);
    expect(sources.every((source) => source.enabled !== false)).toBe(true);
    expect(sources.every((source) => source.config?.endpoint && source.config.itemsPath)).toBe(true);
  });
});
