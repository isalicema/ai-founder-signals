import { createHash } from 'node:crypto';
import { AdapterError } from './errors.js';

const TRACKING_KEYS = new Set([
  'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'source',
]);

export function canonicalizeUrl(input: string, base?: string): string {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch (cause) {
    throw new AdapterError('invalid_source_url', { retryable: false, cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AdapterError('invalid_source_url', { retryable: false });
  }

  const videoId = extractYouTubeVideoId(url);
  if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  url.searchParams.sort();
  return url.toString();
}

export function extractYouTubeVideoId(input: string | URL): string | null {
  const url = typeof input === 'string' ? safeUrl(input) : input;
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
  if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;
  if (url.pathname === '/watch') return validVideoId(url.searchParams.get('v') ?? undefined);
  const [kind, id] = url.pathname.split('/').filter(Boolean);
  return kind === 'shorts' || kind === 'embed' || kind === 'live' ? validVideoId(id) : null;
}

export function fallbackExternalId(url: string): string {
  return `url:${createHash('sha256').update(canonicalizeUrl(url)).digest('hex').slice(0, 24)}`;
}

function validVideoId(value?: string): string | null {
  return value && /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : null;
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}
