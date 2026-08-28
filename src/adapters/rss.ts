import type {
  AdapterFetchContext,
  AdapterSource,
  DiscoveredItem,
  EphemeralContent,
  SourceAdapter,
} from './types.js';
import type { FetchFn } from './http.js';
import { fetchTextResource } from './http.js';
import { parseFeed } from './feedParser.js';
import { AdapterError, FetchBlockedError } from './errors.js';
import { extractArticleText } from './html.js';
import { parsePodcastPage } from './podcastPage.js';

export interface RssAdapterOptions {
  fetcher?: FetchFn;
}

export class RssAdapter implements SourceAdapter {
  readonly kinds = ['rss', 'podcast'] as const;
  readonly #fetcher?: FetchFn;

  constructor(options: RssAdapterOptions = {}) {
    this.#fetcher = options.fetcher;
  }

  async discover(source: AdapterSource): Promise<DiscoveredItem[]> {
    const first = await fetchTextResource(source.url, {
      fetcher: this.#fetcher,
      maxBytes: 5 * 1024 * 1024,
    });
    if (looksLikeFeed(first.text)) return this.#parse(first.text, first.url, source);

    const feedUrl = findAlternateFeedUrl(first.text, first.url);
    if (feedUrl) {
      const linked = await fetchTextResource(feedUrl, {
        fetcher: this.#fetcher,
        maxBytes: 5 * 1024 * 1024,
      });
      return this.#parse(linked.text, linked.url, source);
    }

    if (source.ingestMethod === 'podcast') {
      const items = parsePodcastPage(first.text, first.url, source.language);
      if (items.length > 0) return items;
    }

    throw new AdapterError('feed_not_found', { retryable: false });
  }

  async fetch(item: DiscoveredItem, context: AdapterFetchContext): Promise<EphemeralContent> {
    void context.workspace;
    if (item.mediaType === 'podcast' || item.mediaType === 'video') {
      throw new FetchBlockedError('transcript_unavailable');
    }
    const response = await fetchTextResource(item.url, {
      fetcher: this.#fetcher,
      maxBytes: 10 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    const rawText = extractArticleText(response.text);
    if (rawText.length < 80) throw new FetchBlockedError('article_body_missing');
    return { rawText, language: item.languageHint ?? 'und' };
  }

  #parse(xml: string, sourceUrl: string, source: AdapterSource): DiscoveredItem[] {
    return parseFeed(xml, {
      sourceUrl,
      forcedMediaType: source.ingestMethod === 'podcast' ? 'podcast' : undefined,
      languageHint: source.language,
    });
  }
}

export function findAlternateFeedUrl(html: string, pageUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, 'rel')?.toLowerCase() ?? '';
    const type = attribute(tag, 'type')?.toLowerCase() ?? '';
    const href = attribute(tag, 'href');
    if (href && rel.split(/\s+/).includes('alternate') && /application\/(rss|atom)\+xml/.test(type)) {
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function looksLikeFeed(value: string): boolean {
  return /^\s*<\?xml[\s\S]*?<(rss|feed|rdf:RDF)\b/i.test(value) || /^\s*<(rss|feed|rdf:RDF)\b/i.test(value);
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}
