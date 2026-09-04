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
import { extractEmbeddedNotes, MIN_NOTES_CHARS } from './embeddedNotes.js';

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
    // 长寿命播客常把全部历史节目和完整 show notes 放进同一个 RSS。
    // 科技早知道的真实 Feed 已到 7.4 MB，因此播客单独给 10 MB，普通 RSS 仍守 5 MB。
    const feedMaxBytes = source.ingestMethod === 'podcast' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    const first = await fetchTextResource(source.url, {
      fetcher: this.#fetcher,
      maxBytes: feedMaxBytes,
    });
    if (looksLikeFeed(first.text)) return this.#parse(first.text, first.url, source);

    const feedUrl = findAlternateFeedUrl(first.text, first.url);
    if (feedUrl) {
      const linked = await fetchTextResource(feedUrl, {
        fetcher: this.#fetcher,
        maxBytes: feedMaxBytes,
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
    if (item.mediaType === 'video') {
      throw new FetchBlockedError('transcript_unavailable');
    }

    // 播客：没有逐字稿，但单集页往往内嵌了 show notes。
    // 对我们的用途它甚至比逐字稿更好——已经结构化，没有口语废话。
    if (item.mediaType === 'podcast') {
      const page = await fetchTextResource(item.url, {
        fetcher: this.#fetcher,
        maxBytes: 10 * 1024 * 1024,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      });
      // 小宇宙把 show notes 放在内嵌 JSON；Fireside 则直接服务端渲染在正文。
      // 两种都按页面结构提取，不按域名或信源名称分支。
      const notes = extractEmbeddedNotes(page.text) ?? extractArticleText(page.text);
      if (notes.length < MIN_NOTES_CHARS) throw new FetchBlockedError('transcript_unavailable');
      return { rawText: notes, language: item.languageHint ?? 'und', provenance: 'shownotes' };
    }

    const response = await fetchTextResource(item.url, {
      fetcher: this.#fetcher,
      maxBytes: 10 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    const rawText = extractArticleText(response.text);
    if (rawText.length < 80) throw new FetchBlockedError('article_body_missing');
    return { rawText, language: item.languageHint ?? 'und', provenance: 'body' };
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
