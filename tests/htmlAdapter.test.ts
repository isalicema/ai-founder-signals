import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { HtmlAdapter, discoverHtmlLinks } from '../src/adapters/htmlAdapter.js';
import type { AdapterSource, DiscoveredItem } from '../src/adapters/types.js';

const fixture = (name: string) => readFile(new URL(`./fixtures/html/${name}-list.html`, import.meta.url), 'utf8');

const source = (url: string, fetchMode = 'full'): AdapterSource => ({
  id: '00000000-0000-4000-8000-000000000088',
  name: 'Generic HTML publication',
  url,
  language: 'zh',
  ingestMethod: 'html',
  fetchMode,
});

describe('HtmlAdapter', () => {
  it('finds the numeric-query article family in the first real fixture', async () => {
    const items = discoverHtmlLinks(await fixture('latepost'), 'https://example.com/site/index', 'zh');

    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.every((item) => /^https:\/\/example\.com\/news\/dj_detail\?id=\d+$/.test(item.url))).toBe(true);
    expect(items.every((item) => item.title.length >= 8)).toBe(true);
    expect(items.some((item) => item.title.startsWith('['))).toBe(false);
    expect(items.some((item) => item.title.includes('\n'))).toBe(false);
    expect(items.find((item) => item.externalId === '3366')?.title).toBe('对话与爱为舞张怀亭：大哥创业不走弯路');
    expect(items.some((item) => item.url.includes('/websites/'))).toBe(false);
  });

  it('prefers title-like article anchors over more frequent pagination links', async () => {
    const items = discoverHtmlLinks(await fixture('ainow'), 'https://example.com/zh/ainow', 'zh');

    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.every((item) => item.url.startsWith('https://example.com/zh/ainow/'))).toBe(true);
    expect(items.every((item) => item.title.length >= 8)).toBe(true);
    expect(items.some((item) => item.title.startsWith('['))).toBe(false);
    expect(items.some((item) => item.title.includes('\n'))).toBe(false);
    expect(items.some((item) => /[?&]ap=|\/zh\/(?:about|legal)/.test(item.url))).toBe(false);
  });

  it('absolutizes protocol-relative links and excludes unrelated URL families', async () => {
    const items = discoverHtmlLinks(await fixture('pingwest'), 'https://www.pingwest.com/', 'zh');

    expect(items.length).toBeGreaterThanOrEqual(30);
    expect(items.every((item) => /^https:\/\/www\.pingwest\.com\/a\/\d+$/.test(item.url))).toBe(true);
    expect(items.every((item) => item.title.length >= 8)).toBe(true);
    expect(items.some((item) => item.title.startsWith('['))).toBe(false);
    expect(items.some((item) => item.title.includes('\n'))).toBe(false);
    expect(items.some((item) => /\/(?:w|tag|user)\//.test(item.url))).toBe(false);
  });

  it('is idempotent for every real fixture', async () => {
    for (const [name, url] of [
      ['latepost', 'https://example.com/site/index'],
      ['ainow', 'https://example.com/zh/ainow'],
      ['pingwest', 'https://www.pingwest.com/'],
    ] as const) {
      const html = await fixture(name);
      const first = new Set(discoverHtmlLinks(html, url).map((item) => item.externalId));
      const second = new Set(discoverHtmlLinks(html, url).map((item) => item.externalId));
      expect(first).toEqual(second);
    }
  });

  it('returns an empty list when a page has navigation but no article family', () => {
    const html = '<a href="/">首页</a><a href="/about">关于</a><a href="?page=2">下一页</a>';
    expect(discoverHtmlLinks(html, 'https://example.com/')).toEqual([]);
  });

  it('blocks discover-only body fetches before making a network request', async () => {
    const fetcher = vi.fn(async () => new Response('must not be read')) as typeof fetch;
    const adapter = new HtmlAdapter({ fetcher });
    const item: DiscoveredItem = {
      externalId: '42', url: 'https://example.com/a/42', title: 'A sufficiently long article title',
      publishedAt: null, mediaType: 'article', languageHint: 'en',
    };

    await expect(adapter.fetch(item, {
      workspace: '/unused', source: source('https://example.com', 'discover_only'),
    })).rejects.toMatchObject({ code: 'article_body_missing', itemStatus: 'needs_body' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches a substantial article body in memory', async () => {
    const body = 'Specific product decision and evidence. '.repeat(12);
    const fetcher = vi.fn(async () => new Response(`<article><h1>Founder interview</h1><p>${body}</p></article>`)) as typeof fetch;
    const item: DiscoveredItem = {
      externalId: '42', url: 'https://example.com/a/42', title: 'A sufficiently long article title',
      publishedAt: null, mediaType: 'article', languageHint: 'en',
    };

    const content = await new HtmlAdapter({ fetcher }).fetch(item, {
      workspace: '/unused', source: source('https://example.com'),
    });

    expect(content).toMatchObject({ language: 'en', provenance: 'body' });
    expect(content.rawText.length).toBeGreaterThan(200);
  });

  it('contains no source-name or host-specific branch', async () => {
    const implementation = await readFile(new URL('../src/adapters/htmlAdapter.ts', import.meta.url), 'utf8');
    for (const forbidden of ['latepost', 'pingwest', 'elsewhere.news', '晚点', '品玩', 'AI 闹']) {
      expect(implementation.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
