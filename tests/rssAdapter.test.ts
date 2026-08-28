import { describe, expect, it, vi } from 'vitest';
import type { AdapterSource, DiscoveredItem } from '../src/adapters/types.js';
import { FetchBlockedError } from '../src/adapters/errors.js';
import { RssAdapter, findAlternateFeedUrl } from '../src/adapters/rss.js';
import { PODCAST_FEED } from './fixtures/feeds.js';

const source: AdapterSource = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'A generic podcast',
  url: 'https://example.com/show',
  language: 'zh',
  ingestMethod: 'podcast',
  fetchMode: 'full',
};

describe('RssAdapter', () => {
  it('discovers an alternate RSS link from an HTML source page', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      return url.endsWith('/show')
        ? new Response('<html><head><link href="/feed.xml" type="application/rss+xml" rel="alternate"></head></html>', {
            headers: { 'content-type': 'text/html' },
          })
        : new Response(PODCAST_FEED, { headers: { 'content-type': 'application/rss+xml' } });
    }) as typeof fetch;
    const adapter = new RssAdapter({ fetcher });

    const items = await adapter.discover(source);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: 'episode-42', mediaType: 'podcast' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('extracts an article body in memory', async () => {
    const fetcher = vi.fn(async () => new Response(`
      <html><body><nav>menu noise</nav><article>
        <h1>Founder interview</h1><p>${'Specific product decision and evidence. '.repeat(8)}</p>
      </article><footer>footer noise</footer></body></html>
    `)) as typeof fetch;
    const adapter = new RssAdapter({ fetcher });
    const item: DiscoveredItem = {
      externalId: 'article-1',
      url: 'https://example.com/article-1',
      title: 'Founder interview',
      publishedAt: null,
      mediaType: 'article',
      languageHint: 'en',
    };

    const content = await adapter.fetch(item, { workspace: '/unused' });

    expect(content.language).toBe('en');
    expect(content.rawText).toContain('Specific product decision');
    expect(content.rawText).not.toContain('menu noise');
    expect(content.rawText).not.toContain('footer noise');
  });

  it('discovers server-rendered podcast episode cards when no feed link is exposed', async () => {
    const fetcher = vi.fn(async () => new Response(`
      <html><body><a class="card" href="/episode/episode-99">
        <img src="https://cdn.example.com/cover.jpg" alt="99. 对谈 Acme 创始人 &amp; CEO" class="cover">
        <div class="description"><p>${'产品决策、失败证据与下一步。'.repeat(50)}</p></div>
        <div class="footer">124分钟 · <time datetime="2026-08-26T09:33:46.732Z">2天前</time></div>
      </a></body></html>
    `, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const adapter = new RssAdapter({ fetcher });

    const items = await adapter.discover(source);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: 'episode-99',
      url: 'https://example.com/episode/episode-99',
      title: '99. 对谈 Acme 创始人 & CEO',
      publishedAt: new Date('2026-08-26T09:33:46.732Z'),
      coverUrl: 'https://cdn.example.com/cover.jpg',
      durationSeconds: 7_440,
      mediaType: 'podcast',
      languageHint: 'zh',
    });
    expect(items[0]?.admissionSnippet?.length).toBe(500);
  });

  // 2026-08-29 行为变更：原先播客一律判 transcript_unavailable。实测小宇宙
  // 单集页内嵌了完整 show notes（一集 2796 字，含嘉宾背景与带时间戳的 OUTLINE），
  // 全部弃用太浪费。但这条测试原本的顾虑——「不要把 show notes 当逐字稿」——
  // 仍然成立，所以改为标注来源：provenance='shownotes'，摘要器据此收紧措辞，
  // 不把节目方写的大纲当成受访者的第一人称表达。
  it('podcast 用 show notes 但标注来源，不冒充逐字稿', async () => {
    const notes = '嘉宾背景与话题大纲。'.repeat(60);
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ episode: { shownotes: notes } })}</script>`;
    const adapter = new RssAdapter({ fetcher: async () => new Response(html, {
      headers: { 'content-type': 'text/html' },
    }) });
    const item: DiscoveredItem = {
      externalId: 'episode-1', url: 'https://example.com/episode-1',
      title: 'Podcast episode', publishedAt: null, mediaType: 'podcast',
    };
    const content = await adapter.fetch(item, { workspace: '/unused' });
    expect(content.provenance).toBe('shownotes');
    expect(content.rawText.length).toBeGreaterThan(300);
  });

  it('没有可用 show notes 时仍然判 needs_body', async () => {
    const adapter = new RssAdapter({ fetcher: async () => new Response('<html>空</html>', {
      headers: { 'content-type': 'text/html' },
    }) });
    await expect(adapter.fetch({
      externalId: 'e2', url: 'https://example.com/e2', title: 't',
      publishedAt: null, mediaType: 'podcast',
    }, { workspace: '/unused' })).rejects.toMatchObject({
      code: 'transcript_unavailable', itemStatus: 'needs_body',
    } satisfies Partial<FetchBlockedError>);
  });

  it('finds alternate links regardless of attribute order', () => {
    expect(findAlternateFeedUrl(
      '<link type="application/atom+xml" href="feed.atom" rel="alternate">',
      'https://example.com/show',
    )).toBe('https://example.com/feed.atom');
  });
});
