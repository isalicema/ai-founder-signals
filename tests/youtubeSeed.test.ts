import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../src/db/seed/sources.js';

const LEX_MAIN_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSHZKyawb77ixDdsGog4iWA';
const LEX_CLIPS_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJIfeSCssxSC_Dhc5s7woww';

describe('YouTube source seed', () => {
  it('subscribes to the Lex Fridman main channel and never enables Lex Clips', () => {
    const lex = SEED_SOURCES.find((source) => source.name === 'Lex Fridman');

    expect(lex?.url).toBe(LEX_MAIN_FEED);
    expect(lex?.enabled).not.toBe(false);
    expect(SEED_SOURCES.some((source) => source.url === LEX_CLIPS_FEED && source.enabled !== false)).toBe(false);
  });
});
