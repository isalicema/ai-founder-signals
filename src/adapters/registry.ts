import type { AdapterSource, IngestMethod, SourceAdapter } from './types.js';
import { AdapterError } from './errors.js';
import { RssAdapter, type RssAdapterOptions } from './rss.js';
import { YouTubeAdapter, type YouTubeAdapterOptions } from './youtube.js';

export class AdapterRegistry {
  readonly #adapters = new Map<IngestMethod, SourceAdapter>();

  constructor(adapters: SourceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: SourceAdapter): void {
    for (const kind of adapter.kinds) {
      if (this.#adapters.has(kind)) throw new Error(`Adapter already registered for ${kind}`);
      this.#adapters.set(kind, adapter);
    }
  }

  forSource(source: AdapterSource): SourceAdapter {
    const adapter = this.#adapters.get(source.ingestMethod as IngestMethod);
    if (!adapter) throw new AdapterError('unsupported_ingest_method', { retryable: false });
    return adapter;
  }
}

export interface DefaultAdapterOptions {
  rss?: RssAdapterOptions;
  youtube?: YouTubeAdapterOptions;
}

export function createDefaultAdapterRegistry(options: DefaultAdapterOptions = {}): AdapterRegistry {
  return new AdapterRegistry([
    new RssAdapter(options.rss),
    new YouTubeAdapter(options.youtube),
  ]);
}
