import type { Source } from '../db/schema.js';
import type { SourceConfig } from './config.js';

export type IngestMethod = 'rss' | 'youtube' | 'podcast' | 'html' | 'json_api';
export type MediaType = 'article' | 'video' | 'podcast';

export type AdapterSource = Pick<
  Source,
  'id' | 'name' | 'url' | 'language' | 'ingestMethod' | 'fetchMode'
> & { config?: SourceConfig | null };

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

/** 正文来源。摘要器必须知道自己在读什么，否则会把节目方写的大纲当成对话实录。 */
export type ContentProvenance = 'body' | 'transcript' | 'shownotes';

/** Raw content exists only inside a single worker process and temporary workspace. */
export interface EphemeralContent {
  rawText: string;
  language: string;
  /** 缺省按正文处理 */
  provenance?: ContentProvenance;
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
