export type FeedTier = 'highlight' | 'feed' | 'folded';
export type FeedMediaType = 'article' | 'video' | 'podcast';
export type FeedRegion = '国内' | '海外';

export interface FeedEntityRef {
  id: string | null;
  kind: 'person' | 'company';
  name: string;
  starred: boolean;
}

export interface MonthlyMention {
  name: string;
  count: number;
}

export interface FeedItemView {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  country: string | null;
  region: FeedRegion;
  mediaType: FeedMediaType;
  publishedAt: string | null;
  firstSeenAt: string;
  durationSeconds: number | null;
  contentChars: number | null;
  coverUrl: string | null;
  summary: string | null;
  tags: string[];
  persons: string[];
  companies: string[];
  entities: FeedEntityRef[];
  tier: FeedTier;
  readAt: string | null;
  archiveRequestedAt: string | null;
  status: string;
  rejectReason: string | null;
  isNewEntity: boolean;
  monthlyMention: MonthlyMention | null;
  coverTone: number;
}

export interface FeedPayload {
  items: FeedItemView[];
  generatedAt: string;
  mode: 'database' | 'demo';
  notice?: string;
}

export interface FeedFilters {
  person: string;
  company: string;
  source: string;
  tag: string;
  region: '' | FeedRegion;
  mediaType: '' | FeedMediaType;
}

export type FeedItemAction =
  | { type: 'opened_source'; itemId: string; at: string }
  | { type: 'archive_requested'; itemId: string; at: string }
  | { type: 'irrelevant'; itemId: string; at: string }
  | { type: 'set_highlight'; itemId: string; highlighted: boolean; at: string }
  | { type: 'set_items_read'; itemIds: string[]; readAt: string | null }
  | { type: 'toggle_entity_star'; itemId: string; entityId: string | null; entityName: string; entityKind: 'person' | 'company'; starred: boolean; at: string };

export interface FeedActionResult {
  ok: boolean;
  persisted: boolean;
}
