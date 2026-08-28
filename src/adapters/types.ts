import type { Source } from '../db/schema.js';

export type IngestMethod = 'rss' | 'youtube' | 'podcast' | 'html';
export type MediaType = 'article' | 'video' | 'podcast';

export type AdapterSource = Pick<
  Source,
  'id' | 'name' | 'url' | 'language' | 'ingestMethod' | 'fetchMode'
>;

export interface DiscoveredItem {
  /** Stable source-scoped id: RSS guid, Atom id, or YouTube video id. */
  externalId: string;
  url: string;
  title: string;
  publishedAt: Date | null;
  coverUrl?: string;
  durationSeconds?: number;
  mediaType: MediaType;
  /** Source-supplied list metadata, capped at 500 chars and never logged. */
  admissionSnippet?: string;
  languageHint?: string;
}

/** Raw content exists only inside a single worker process and temporary workspace. */
export interface EphemeralContent {
  rawText: string;
  language: string;
}

export interface AdapterFetchContext {
  /** Must be a directory created and owned by withTempWorkspace(). */
  workspace: string;
}

export interface SourceAdapter {
  readonly kinds: readonly IngestMethod[];
  discover(source: AdapterSource): Promise<DiscoveredItem[]>;
  fetch(item: DiscoveredItem, context: AdapterFetchContext): Promise<EphemeralContent>;
}
