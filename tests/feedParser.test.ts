import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/adapters/feedParser.js';
import { AdapterError } from '../src/adapters/errors.js';
import { PODCAST_FEED, YOUTUBE_FEED } from './fixtures/feeds.js';

describe('parseFeed', () => {
  it('parses a real-shaped YouTube Atom entry without keeping tracking URL state', () => {
    const [item] = parseFeed(YOUTUBE_FEED, {
      sourceUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=test',
      forcedMediaType: 'video',
      languageHint: 'en',
    });

    expect(item).toMatchObject({
      externalId: 'abcDEF_1234',
      url: 'https://www.youtube.com/watch?v=abcDEF_1234',
      mediaType: 'video',
      languageHint: 'en',
      coverUrl: 'https://i.ytimg.com/vi/abcDEF_1234/hqdefault.jpg',
    });
    expect(item?.publishedAt?.toISOString()).toBe('2026-08-28T16:30:06.000Z');
    expect(item?.admissionSnippet).toHaveLength(500);
  });

  it('parses RSS podcast facts, duration, guid and canonical URL', () => {
    const [item] = parseFeed(PODCAST_FEED, {
      sourceUrl: 'https://example.com/feed.xml',
      forcedMediaType: 'podcast',
      languageHint: 'zh',
    });

    expect(item).toMatchObject({
      externalId: 'episode-42',
      url: 'https://example.com/episodes/42',
      mediaType: 'podcast',
      durationSeconds: 3723,
      coverUrl: 'https://cdn.example.com/cover.jpg',
      admissionSnippet: '这是一段用于准入判断的节目介绍。',
    });
  });

  it('keeps the first text value when namespace removal merges duplicate title tags', () => {
    const [item] = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel><item>
          <title>180: RSS 标题</title><itunes:title>iTunes 标题</itunes:title>
          <link>https://example.com/episodes/180</link><guid>episode-180</guid>
        </item></channel>
      </rss>`, {
      sourceUrl: 'https://example.com/feed.xml',
      forcedMediaType: 'podcast',
      languageHint: 'zh',
    });

    expect(item?.title).toBe('180: RSS 标题');
  });

  it('rejects valid XML that is not a supported feed', () => {
    expect(() => parseFeed('<document><item>no channel</item></document>', {
      sourceUrl: 'https://example.com/not-feed.xml',
    })).toThrowError(AdapterError);
  });
});
