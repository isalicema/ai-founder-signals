import { describe, expect, it } from 'vitest';
import type { AdapterSource } from '../src/adapters/types.js';
import { AdapterRegistry, createDefaultAdapterRegistry } from '../src/adapters/registry.js';
import { AdapterError } from '../src/adapters/errors.js';

const source = (ingestMethod: AdapterSource['ingestMethod'], name: string): AdapterSource => ({
  id: '00000000-0000-4000-8000-000000000003',
  name,
  url: 'https://example.com/source',
  language: 'en',
  ingestMethod,
  fetchMode: 'full',
});

describe('AdapterRegistry', () => {
  it('routes only by ingestMethod, never by source name', () => {
    const registry = createDefaultAdapterRegistry();
    expect(registry.forSource(source('youtube', '晚点')))
      .toBe(registry.forSource(source('youtube', 'Completely different name')));
    expect(registry.forSource(source('podcast', 'Any podcast')).kinds).toContain('rss');
  });

  it('keeps unsupported HTML sources explicit until their adapter is registered', () => {
    const registry = new AdapterRegistry();
    expect(() => registry.forSource(source('html', 'Generic HTML source')))
      .toThrowError(AdapterError);
  });
});
