import type { DiscoveredItem } from './types.js';
import { admissionSnippet } from './html.js';

/**
 * Parses server-rendered podcast episode cards when a show page exposes no RSS
 * discovery link. The parser keys off semantic episode URLs and metadata only;
 * it has no source-name or host-specific branch.
 */
export function parsePodcastPage(
  html: string,
  pageUrl: string,
  languageHint?: string | null,
): DiscoveredItem[] {
  const items = new Map<string, DiscoveredItem>();

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const href = attribute(attributes, 'href');
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    const externalId = url.pathname.match(/\/episode\/([^/?#]+)/i)?.[1];
    if (!externalId || items.has(externalId)) continue;

    const cover = [...body.matchAll(/<img\b([^>]*)>/gi)]
      .map((image) => image[1] ?? '')
      .find((image) => attribute(image, 'alt'));
    const title = admissionSnippet(cover && attribute(cover, 'alt'));
    if (!title) continue;

    const description = elementBodyWithClass(body, 'description');
    const timeTag = body.match(/<time\b([^>]*)>/i)?.[1];
    const publishedAt = parseDate(timeTag && attribute(timeTag, 'datetime'));
    const minutes = body.match(/(\d+(?:\.\d+)?)\s*分钟/i)?.[1];
    const coverUrl = cover && attribute(cover, 'src');

    items.set(externalId, {
      externalId,
      url: url.toString(),
      title,
      publishedAt,
      ...(coverUrl ? { coverUrl } : {}),
      ...(minutes ? { durationSeconds: Math.round(Number(minutes) * 60) } : {}),
      mediaType: 'podcast',
      admissionSnippet: admissionSnippet(description) ?? title.slice(0, 500),
      ...(languageHint ? { languageHint } : {}),
    });
  }

  return [...items.values()];
}

function elementBodyWithClass(html: string, className: string): string | undefined {
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const classes = attribute(match[2] ?? '', 'class')?.split(/\s+/) ?? [];
    if (classes.includes(className)) return match[3];
  }
  return undefined;
}

function attribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
