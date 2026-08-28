import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractYouTubeVideoId, fallbackExternalId } from '../src/adapters/url.js';
import { assertPublicHttpUrl } from '../src/adapters/http.js';
import { AdapterError } from '../src/adapters/errors.js';

describe('adapter URL boundaries', () => {
  it('normalizes query order and removes tracking parameters', () => {
    expect(canonicalizeUrl('https://Example.com/story/?b=2&utm_source=x&a=1#section'))
      .toBe('https://example.com/story?a=1&b=2');
  });

  it('normalizes YouTube watch, short and youtu.be URLs to one key', () => {
    const expected = 'https://www.youtube.com/watch?v=abcDEF_1234';
    expect(canonicalizeUrl('https://youtu.be/abcDEF_1234?t=20')).toBe(expected);
    expect(canonicalizeUrl('https://youtube.com/shorts/abcDEF_1234')).toBe(expected);
    expect(extractYouTubeVideoId(expected)).toBe('abcDEF_1234');
  });

  it('generates a deterministic fallback external id', () => {
    expect(fallbackExternalId('https://example.com/a?utm_source=x'))
      .toBe(fallbackExternalId('https://example.com/a'));
  });

  it('rejects local/private fetch targets', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1', 'http://192.168.1.2', 'file:///etc/passwd']) {
      expect(() => assertPublicHttpUrl(url), url).toThrowError(AdapterError);
    }
  });
});
