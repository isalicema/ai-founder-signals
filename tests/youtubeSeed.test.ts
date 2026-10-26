import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../src/db/seed/sources.js';

const LEX_MAIN_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSHZKyawb77ixDdsGog4iWA';
const LEX_CLIPS_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJIfeSCssxSC_Dhc5s7woww';
const TWENTY_VC_CHANNEL_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCf0PBRjhf0rF8fWBIxTuoWA';
const TWENTY_VC_FULL_EPISODES_FEED = 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLnJFlI3aINuUNaznonoFEgMUGLBiLmB-w';
const DAVID_SENRA_CHANNEL_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCy2FPslt0LLPsIV0iukvHpQ';
const DAVID_SENRA_FULL_EPISODES_FEED = 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLn5mxQAXXebxbQY3BqpmbYWYty0_zJraA';
const A16Z_DEEP_DIVES_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCQ1VQj-37kl2yS_VUhfQHsw';
const A16Z_PODCAST_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC9cn0TuPq4dnbTY-CBsm8XA';

describe('YouTube source seed', () => {
  it('subscribes to the Lex Fridman main channel and never enables Lex Clips', () => {
    const lex = SEED_SOURCES.find((source) => source.name === 'Lex Fridman');

    expect(lex?.url).toBe(LEX_MAIN_FEED);
    expect(lex?.enabled).not.toBe(false);
    expect(SEED_SOURCES.some((source) => source.url === LEX_CLIPS_FEED && source.enabled !== false)).toBe(false);
  });

  it('subscribes to 20VC full episodes without enabling its Shorts-heavy channel feed', () => {
    const source = SEED_SOURCES.find((candidate) => candidate.name === '20VC');

    expect(source).toMatchObject({
      url: TWENTY_VC_FULL_EPISODES_FEED,
      country: 'GB',
      language: 'en',
      ingestMethod: 'youtube',
      fetchMode: 'full',
      purity: 0.4,
    });
    expect(source?.enabled).not.toBe(false);
    expect(SEED_SOURCES.some((candidate) => candidate.url === TWENTY_VC_CHANNEL_FEED && candidate.enabled !== false)).toBe(false);
  });

  it('subscribes to David Senra full interviews without enabling its clip-heavy channel feed', () => {
    const source = SEED_SOURCES.find((candidate) => candidate.name === 'David Senra');

    expect(source).toMatchObject({
      url: DAVID_SENRA_FULL_EPISODES_FEED,
      country: 'US',
      language: 'en',
      ingestMethod: 'youtube',
      fetchMode: 'full',
      purity: 0.6,
    });
    expect(source?.enabled).not.toBe(false);
    expect(SEED_SOURCES.some((candidate) => candidate.url === DAVID_SENRA_CHANNEL_FEED && candidate.enabled !== false)).toBe(false);
  });

  it('keeps a16z Deep Dives and a16z Podcast as separate sources', () => {
    const deepDives = SEED_SOURCES.find((candidate) => candidate.name === 'a16z Deep Dives');
    const podcast = SEED_SOURCES.find((candidate) => candidate.name === 'a16z Podcast');

    expect(deepDives).toMatchObject({
      url: A16Z_DEEP_DIVES_FEED,
      country: 'US',
      language: 'en',
      ingestMethod: 'youtube',
      fetchMode: 'full',
      purity: 0.3,
    });
    expect(podcast).toMatchObject({
      url: A16Z_PODCAST_FEED,
      country: 'US',
      language: 'en',
      ingestMethod: 'youtube',
      fetchMode: 'full',
      purity: 0.3,
    });
    expect(deepDives?.enabled).not.toBe(false);
    expect(podcast?.enabled).not.toBe(false);
  });
});
