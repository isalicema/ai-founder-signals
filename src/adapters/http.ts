import { AdapterError } from './errors.js';

export type FetchFn = typeof fetch;

export interface FetchTextOptions {
  fetcher?: FetchFn;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchedText {
  text: string;
  url: string;
  contentType: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export async function fetchTextResource(
  input: string,
  options: FetchTextOptions = {},
): Promise<FetchedText> {
  const url = assertPublicHttpUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const headers = new Headers(options.headers);
    if (!headers.has('accept')) {
      headers.set('accept', options.accept ?? 'text/html,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5');
    }
    headers.set('user-agent', 'AI-Founder-Signals/0.1 (+https://github.com/machiwhale-studio)');
    const response = await (options.fetcher ?? fetch)(url, {
      method: options.method ?? 'GET',
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      throw new AdapterError('fetch_failed', { retryable });
    }
    assertPublicHttpUrl(response.url || url);

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new AdapterError('response_too_large', { retryable: false });
    }

    const bytes = await readLimitedBody(response, maxBytes);
    return {
      text: new TextDecoder(contentCharset(response.headers.get('content-type'))).decode(bytes),
      url: response.url || url,
      contentType: response.headers.get('content-type') ?? '',
    };
  } catch (cause) {
    if (cause instanceof AdapterError) throw cause;
    if (controller.signal.aborted) throw new AdapterError('fetch_timeout', { retryable: true, cause });
    throw new AdapterError('fetch_failed', { retryable: true, cause });
  } finally {
    clearTimeout(timeout);
  }
}

export function assertPublicHttpUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new AdapterError('invalid_source_url', { retryable: false, cause });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AdapterError('invalid_source_url', { retryable: false });
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    isPrivateIpv4(hostname)
  ) {
    throw new AdapterError('private_source_url', { retryable: false });
  }
  return url.toString();
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new AdapterError('response_too_large', { retryable: false });
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function contentCharset(contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  try {
    new TextDecoder(charset ?? 'utf-8');
    return charset ?? 'utf-8';
  } catch {
    return 'utf-8';
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
