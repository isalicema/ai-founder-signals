import { createHash } from 'node:crypto';
import { FetchBlockedError } from './errors.js';
import { extractArticleText } from './html.js';
import { fetchTextResource, type FetchFn } from './http.js';
import { canonicalizeUrl } from './url.js';
import type {
  AdapterFetchContext,
  AdapterSource,
  DiscoveredItem,
  EphemeralContent,
  SourceAdapter,
} from './types.js';

export interface HtmlAdapterOptions {
  fetcher?: FetchFn;
}

interface LinkCandidate {
  externalId: string;
  url: string;
  shape: string;
  title: string;
  coverUrl?: string;
}

const STOP_TITLES = new Set([
  '下一页', '上一页', '更多', '首页', '主页', '关于', '登录', '注册',
  'more', 'next', 'prev', 'previous', 'home', 'about', 'login', 'log in',
  'sign in', 'register', 'sign up',
]);

export class HtmlAdapter implements SourceAdapter {
  readonly kinds = ['html'] as const;
  readonly #fetcher?: FetchFn;

  constructor(options: HtmlAdapterOptions = {}) {
    this.#fetcher = options.fetcher;
  }

  async discover(source: AdapterSource): Promise<DiscoveredItem[]> {
    const response = await fetchTextResource(source.url, {
      fetcher: this.#fetcher,
      maxBytes: 5 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    return discoverHtmlLinks(response.text, response.url, source.language);
  }

  async fetch(item: DiscoveredItem, context: AdapterFetchContext): Promise<EphemeralContent> {
    if (context.source?.fetchMode === 'discover_only') {
      throw new FetchBlockedError('article_body_missing');
    }
    const response = await fetchTextResource(item.url, {
      fetcher: this.#fetcher,
      maxBytes: 10 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    const rawText = extractArticleText(response.text);
    if (rawText.length < 200) throw new FetchBlockedError('article_body_missing');
    return { rawText, language: item.languageHint ?? 'und', provenance: 'body' };
  }
}

/**
 * Finds the URL family whose anchors most resemble article titles. The score is
 * deliberately content-shaped rather than host-shaped: a new source changes
 * data, never this parser.
 */
export function discoverHtmlLinks(
  html: string,
  pageUrl: string,
  languageHint?: string | null,
): DiscoveredItem[] {
  const page = new URL(pageUrl);
  const groups = new Map<string, LinkCandidate[]>();

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const rawHref = attribute(attributes, 'href')?.trim();
    if (!rawHref || /^(?:#|mailto:|javascript:)/i.test(rawHref)) continue;

    let url: URL;
    try {
      url = new URL(decodeHtmlAttribute(rawHref), page);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== page.origin) continue;

    // Reuse the guarded plain-text converter so image URLs and hrefs can never
    // masquerade as titles. This is the sole L1 admission input downstream.
    const title = extractArticleText(body);
    const coverUrl = firstImageUrl(body, url);
    const candidate: LinkCandidate = {
      externalId: externalIdFor(url),
      url: url.toString(),
      shape: urlShape(url),
      title,
      ...(coverUrl ? { coverUrl } : {}),
    };
    const group = groups.get(candidate.shape) ?? [];
    group.push(candidate);
    groups.set(candidate.shape, group);
  }

  const ranked = [...groups.values()].sort((left, right) => {
    const titleDifference = titleishCount(right) - titleishCount(left);
    if (titleDifference !== 0) return titleDifference;
    const sizeDifference = right.length - left.length;
    if (sizeDifference !== 0) return sizeDifference;
    return (left[0]?.shape ?? '').localeCompare(right[0]?.shape ?? '');
  });
  const selected = ranked[0] ?? [];
  if (titleishCount(selected) < 3) return [];

  return selected.filter((candidate) => isTitleish(candidate.title)).map((candidate) => ({
    externalId: candidate.externalId,
    url: candidate.url,
    title: candidate.title,
    publishedAt: null,
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
    mediaType: 'article',
    ...(languageHint ? { languageHint } : {}),
  }));
}

function titleishCount(candidates: LinkCandidate[]): number {
  return candidates.reduce((count, candidate) => count + Number(isTitleish(candidate.title)), 0);
}

function isTitleish(title: string): boolean {
  const normalized = title.trim();
  return normalized.length >= 8 && !/^\d+$/.test(normalized) && !STOP_TITLES.has(normalized.toLowerCase());
}

function urlShape(url: URL): string {
  const pathname = `/${url.pathname.split('/').filter(Boolean)
    .map((segment) => isIdLike(decodeURIComponentSafe(segment)) ? '{id}' : segment)
    .join('/')}`;
  const keys = [...new Set(url.searchParams.keys())].sort();
  return keys.length > 0 ? `${pathname}?${keys.join('&')}` : pathname;
}

function externalIdFor(url: URL): string {
  const pathId = url.pathname.split('/').filter(Boolean).reverse()
    .map(decodeURIComponentSafe).find(isIdLike);
  if (pathId) return pathId;
  for (const value of url.searchParams.values()) {
    if (isIdLike(value)) return value;
  }
  return createHash('sha256').update(canonicalizeUrl(url.toString())).digest('hex').slice(0, 16);
}

function isIdLike(value: string): boolean {
  return /^\d+$/.test(value) || (value.length >= 6 && /\d/.test(value));
}

function firstImageUrl(body: string, base: URL): string | undefined {
  const image = body.match(/<img\b([^>]*)>/i)?.[1];
  const src = image && attribute(image, 'src');
  if (!src) return undefined;
  try {
    const url = new URL(decodeHtmlAttribute(src), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`,
    'i',
  ));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
