import { AdapterError, FetchBlockedError } from './errors.js';
import { admissionSnippet, extractArticleText } from './html.js';
import { assertPublicHttpUrl, fetchTextResource, type FetchFn } from './http.js';
import { sourceConfigSchema, type SourceConfig } from './config.js';
import type {
  AdapterFetchContext,
  AdapterSource,
  DiscoveredItem,
  EphemeralContent,
  SourceAdapter,
} from './types.js';

export interface JsonApiAdapterOptions {
  fetcher?: FetchFn;
}

export class JsonApiAdapter implements SourceAdapter {
  readonly kinds = ['json_api'] as const;
  readonly #fetcher?: FetchFn;

  constructor(options: JsonApiAdapterOptions = {}) {
    this.#fetcher = options.fetcher;
  }

  async discover(source: AdapterSource): Promise<DiscoveredItem[]> {
    const config = parseConfig(source.config);
    const endpoint = endpointWithQuery(config);
    const response = await fetchTextResource(endpoint, {
      fetcher: this.#fetcher,
      method: config.method,
      headers: config.method === 'POST'
        ? { ...config.headers, 'content-type': 'application/json' }
        : config.headers,
      body: config.method === 'POST' ? JSON.stringify(config.body ?? {}) : undefined,
      accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
      maxBytes: 5 * 1024 * 1024,
    });

    let payload: unknown;
    try {
      payload = JSON.parse(response.text);
    } catch (cause) {
      throw new AdapterError('invalid_api_response', { retryable: true, cause });
    }

    const rows = valueAt(payload, config.itemsPath);
    if (!Array.isArray(rows)) return [];

    const found: DiscoveredItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const item = mapItem(row, config, source.language);
      if (!item || seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      found.push(item);
    }
    return found;
  }

  async fetch(item: DiscoveredItem, context: AdapterFetchContext): Promise<EphemeralContent> {
    void context.workspace;
    const response = await fetchTextResource(item.url, {
      fetcher: this.#fetcher,
      maxBytes: 10 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    const rawText = extractArticleText(response.text);
    if (rawText.length < 80) throw new FetchBlockedError('article_body_missing');
    return { rawText, language: item.languageHint ?? 'und', provenance: 'body' };
  }
}

function parseConfig(value: unknown): SourceConfig {
  const parsed = sourceConfigSchema.safeParse(value);
  if (!parsed.success) throw new AdapterError('invalid_source_config', { retryable: false });
  return parsed.data;
}

function endpointWithQuery(config: SourceConfig): string {
  const url = new URL(assertPublicHttpUrl(config.endpoint));
  for (const [key, value] of Object.entries(config.query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

function mapItem(row: unknown, config: SourceConfig, language: string | null): DiscoveredItem | null {
  if (!row || typeof row !== 'object') return null;
  const externalId = scalarText(valueAt(row, config.map.externalId));
  const title = scalarText(valueAt(row, config.map.title));
  if (!externalId || !title) return null;

  const directUrl = config.map.url ? scalarText(valueAt(row, config.map.url)) : '';
  const candidateUrl = directUrl || config.map.urlTemplate?.replaceAll('{externalId}', encodeURIComponent(externalId));
  if (!candidateUrl) return null;

  let url: string;
  try {
    url = assertPublicHttpUrl(candidateUrl);
  } catch {
    return null;
  }

  const snippet = config.map.snippet
    ? admissionSnippet(valueAt(row, config.map.snippet))
    : undefined;
  const coverUrl = config.map.coverUrl
    ? publicUrlOrUndefined(scalarText(valueAt(row, config.map.coverUrl)))
    : undefined;

  return {
    externalId,
    url,
    title,
    publishedAt: config.map.publishedAt ? dateValue(valueAt(row, config.map.publishedAt)) : null,
    coverUrl,
    mediaType: 'article',
    admissionSnippet: snippet,
    languageHint: language ?? undefined,
  };
}

function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function dateValue(value: unknown): Date | null {
  let milliseconds: number;
  if (typeof value === 'number') {
    milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  } else {
    const raw = scalarText(value);
    if (!raw) return null;
    milliseconds = /^\d{10,13}$/.test(raw)
      ? Number(raw) * (raw.length === 10 ? 1_000 : 1)
      : Date.parse(raw);
  }
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

function publicUrlOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return assertPublicHttpUrl(value);
  } catch {
    return undefined;
  }
}
