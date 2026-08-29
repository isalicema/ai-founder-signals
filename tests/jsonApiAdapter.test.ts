import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../src/adapters/errors.js';
import { JsonApiAdapter } from '../src/adapters/jsonApi.js';
import type { SourceConfig } from '../src/adapters/config.js';
import type { AdapterSource, DiscoveredItem } from '../src/adapters/types.js';

const source = (config: SourceConfig | null): AdapterSource => ({
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Generic JSON publication',
  url: 'https://example.com/publication',
  language: 'zh',
  ingestMethod: 'json_api',
  fetchMode: 'full',
  config,
});

const getConfig: SourceConfig = {
  endpoint: 'https://api.example.com/list',
  method: 'GET',
  headers: { Referer: 'https://example.com/' },
  query: { page: '1', order: 'new' },
  itemsPath: 'data.list',
  map: {
    externalId: 'id', title: 'headline', snippet: 'summary', publishedAt: 'published',
    coverUrl: 'images.0', url: 'href',
  },
};

describe('JsonApiAdapter', () => {
  it('maps a configured GET response, preserves real dates, and stays idempotent', async () => {
    const payload = { data: { list: [
      {
        id: 42,
        headline: '对话一位产品创始人',
        summary: '<p>产品证据与失败复盘。</p>',
        published: '2026-08-29T02:03:04Z',
        images: ['https://cdn.example.com/42.jpg'],
        href: 'https://example.com/articles/42',
      },
    ] } };
    const fetcherMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    }));
    const adapter = new JsonApiAdapter({ fetcher: fetcherMock as typeof fetch });

    const first = await adapter.discover(source(getConfig));
    const second = await adapter.discover(source(getConfig));

    expect(first).toEqual(second);
    expect(first).toEqual([{
      externalId: '42',
      url: 'https://example.com/articles/42',
      title: '对话一位产品创始人',
      publishedAt: new Date('2026-08-29T02:03:04Z'),
      coverUrl: 'https://cdn.example.com/42.jpg',
      mediaType: 'article',
      admissionSnippet: '产品证据与失败复盘。',
      languageHint: 'zh',
    }]);
    const [requestUrl, init] = fetcherMock.mock.calls[0]!;
    expect(String(requestUrl)).toContain('page=1');
    expect(String(requestUrl)).toContain('order=new');
    expect((init?.headers as Headers).get('referer')).toBe('https://example.com/');
  });

  it('sends configured POST JSON and expands the external-id URL template', async () => {
    const config: SourceConfig = {
      endpoint: 'https://api.example.com/stories', method: 'POST',
      headers: { Origin: 'https://example.com' },
      body: { page: 1, sort: 'new' }, itemsPath: 'items',
      map: {
        externalId: 'key', title: 'title', publishedAt: 'created',
        urlTemplate: 'https://example.com/view/{externalId}',
      },
    };
    const fetcherMock = vi.fn(async () => new Response(JSON.stringify({ items: [{
      key: 'story/7', title: 'Founder retrospective', created: 1_787_884_234,
    }] })));
    const items = await new JsonApiAdapter({ fetcher: fetcherMock as typeof fetch }).discover(source(config));

    expect(items[0]).toMatchObject({
      externalId: 'story/7',
      url: 'https://example.com/view/story%2F7',
      publishedAt: new Date(1_787_884_234_000),
    });
    const init = fetcherMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ page: 1, sort: 'new' }));
    expect((init?.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('returns an empty list when itemsPath is absent and skips malformed rows', async () => {
    const adapter = new JsonApiAdapter({ fetcher: async () => new Response('{"elsewhere":[]}') });
    await expect(adapter.discover(source(getConfig))).resolves.toEqual([]);

    const mixed = new JsonApiAdapter({ fetcher: async () => new Response(JSON.stringify({ data: { list: [
      { id: 'same', headline: 'Valid', href: 'https://example.com/a' },
      { id: 'same', headline: 'Duplicate', href: 'https://example.com/b' },
      { id: 'missing-title', href: 'https://example.com/c' },
      { id: 'private', headline: 'Private URL', href: 'http://127.0.0.1/private' },
    ] } })) });
    await expect(mixed.discover(source(getConfig))).resolves.toHaveLength(1);
  });

  it('rejects missing configuration and malformed JSON with safe adapter codes', async () => {
    const adapter = new JsonApiAdapter({ fetcher: async () => new Response('not-json') });
    await expect(adapter.discover(source(null))).rejects.toMatchObject({
      code: 'invalid_source_config', retryable: false,
    } satisfies Partial<AdapterError>);
    await expect(adapter.discover(source(getConfig))).rejects.toMatchObject({
      code: 'invalid_api_response', retryable: true,
    } satisfies Partial<AdapterError>);
  });

  it('classifies HTTP failures without producing partial items', async () => {
    for (const [status, retryable] of [[404, false], [429, true], [503, true]] as const) {
      const adapter = new JsonApiAdapter({ fetcher: async () => new Response('failed', { status }) });
      await expect(adapter.discover(source(getConfig))).rejects.toMatchObject({
        code: 'fetch_failed', retryable,
      } satisfies Partial<AdapterError>);
    }
  });

  it('fetches article HTML through the shared guarded resource loader', async () => {
    const fetcher = vi.fn(async () => new Response(`<html><article>
      <h1>Founder interview</h1><p>${'Specific product evidence and decisions. '.repeat(8)}</p>
    </article></html>`)) as typeof fetch;
    const item: DiscoveredItem = {
      externalId: 'a1', url: 'https://example.com/a1', title: 'Founder interview',
      publishedAt: null, mediaType: 'article', languageHint: 'en',
    };

    const content = await new JsonApiAdapter({ fetcher }).fetch(item, { workspace: '/unused' });

    expect(content).toMatchObject({ language: 'en', provenance: 'body' });
    expect(content.rawText).toContain('Specific product evidence');
  });

  it('keeps every site-specific string out of the adapter implementation', async () => {
    const implementation = await readFile(new URL('../src/adapters/jsonApi.ts', import.meta.url), 'utf8');
    for (const forbidden of ['baai', 'qq.com', '36kr', 'Founder Park', 'Waveline', 'Z Potentials']) {
      expect(implementation).not.toContain(forbidden);
    }
  });
});
