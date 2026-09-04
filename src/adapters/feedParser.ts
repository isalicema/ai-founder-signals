import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { DiscoveredItem, MediaType } from './types.js';
import { AdapterError } from './errors.js';
import { admissionSnippet } from './html.js';
import { canonicalizeUrl, extractYouTubeVideoId, fallbackExternalId } from './url.js';

type JsonRecord = Record<string, unknown>;

export interface ParseFeedOptions {
  sourceUrl: string;
  forcedMediaType?: MediaType;
  languageHint?: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseFeed(xml: string, options: ParseFeedOptions): DiscoveredItem[] {
  if (XMLValidator.validate(xml) !== true) {
    throw new AdapterError('invalid_feed', { retryable: false });
  }
  const document = asRecord(parser.parse(xml) as unknown) ?? {};
  const atomFeed = asRecord(document.feed);
  const rssChannel = asRecord(asRecord(document.rss)?.channel);
  const rdfRoot = asRecord(document.RDF);
  const entries = atomFeed
    ? asArray(atomFeed.entry)
    : rssChannel
      ? asArray(rssChannel.item)
      : rdfRoot
        ? asArray(rdfRoot.item)
        : [];
  if (entries.length === 0) throw new AdapterError('invalid_feed', { retryable: false });

  const items: DiscoveredItem[] = [];
  const seen = new Set<string>();
  for (const candidate of entries) {
    const entry = asRecord(candidate);
    if (!entry) continue;
    const item = parseEntry(entry, options);
    if (!item || seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    items.push(item);
  }
  return items;
}

function parseEntry(entry: JsonRecord, options: ParseFeedOptions): DiscoveredItem | null {
  const group = asRecord(entry.group);
  const videoId = firstText(entry.videoId) ?? extractYouTubeVideoId(linkValue(entry.link, options.sourceUrl) ?? '');
  const link = linkValue(entry.link, options.sourceUrl) ?? firstText(entry.guid);
  const url = videoId
    ? link ?? `https://www.youtube.com/watch?v=${videoId}`
    : link;
  if (!url) return null;

  let normalizedUrl: string;
  try {
    normalizedUrl = canonicalizeUrl(url, options.sourceUrl);
  } catch {
    return null;
  }
  const title = firstText(entry.title) ?? firstText(group?.title);
  if (!title) return null;

  const guid = firstText(entry.guid) ?? firstText(entry.id);
  const externalId = videoId ?? guid ?? fallbackExternalId(normalizedUrl);
  const mediaType = options.forcedMediaType ?? inferMediaType(entry, group);
  const snippet = admissionSnippet(
    group?.description ?? entry.summary ?? entry.description ?? entry.encoded ?? entry.content,
  );
  const coverUrl = imageUrl(group?.thumbnail) ?? imageUrl(entry.thumbnail) ?? imageUrl(entry.image);
  const durationSeconds = parseDuration(group?.duration ?? entry.duration);
  const publishedAt = parseDate(
    firstText(entry.published) ?? firstText(entry.pubDate) ?? firstText(entry.updated) ?? firstText(entry.date),
  );

  return {
    externalId,
    url: normalizedUrl,
    title,
    publishedAt,
    mediaType,
    ...(coverUrl ? { coverUrl } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(snippet ? { admissionSnippet: snippet } : {}),
    ...(options.languageHint ? { languageHint: options.languageHint } : {}),
  };
}

function inferMediaType(entry: JsonRecord, group: JsonRecord | null): MediaType {
  if (firstText(entry.videoId)) return 'video';
  const enclosure = asRecord(asArray(entry.enclosure)[0]);
  const mediaContent = asRecord(asArray(group?.content)[0]);
  const type = attr(enclosure, 'type') ?? attr(mediaContent, 'type') ?? '';
  const url = attr(enclosure, 'url') ?? attr(mediaContent, 'url') ?? '';
  if (type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg)(?:$|\?)/i.test(url)) return 'podcast';
  if (type.startsWith('video/') || /\.(mp4|mov|webm)(?:$|\?)/i.test(url)) return 'video';
  return 'article';
}

function linkValue(value: unknown, base: string): string | null {
  const links = asArray(value);
  for (const candidate of links) {
    const record = asRecord(candidate);
    const href = attr(record, 'href');
    const rel = attr(record, 'rel');
    if (href && (!rel || rel === 'alternate')) return resolveUrl(href, base);
    const text = firstText(candidate);
    if (text?.startsWith('http')) return resolveUrl(text, base);
  }
  return null;
}

function imageUrl(value: unknown): string | undefined {
  for (const candidate of asArray(value)) {
    const record = asRecord(candidate);
    const url = attr(record, 'url') ?? attr(record, 'href') ?? firstText(candidate);
    if (url?.startsWith('http')) return url;
  }
  return undefined;
}

function parseDuration(value: unknown): number | undefined {
  const record = asRecord(value);
  const raw = attr(record, 'seconds') ?? firstText(value);
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const clock = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const iso = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) return Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
  return undefined;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function firstText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const text = firstText(candidate);
      if (text) return text;
    }
    return undefined;
  }
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const record = asRecord(value);
  return record ? firstText(record['#text']) : undefined;
}

function attr(record: JsonRecord | null, name: string): string | undefined {
  return record ? firstText(record[`@_${name}`]) : undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function resolveUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}
