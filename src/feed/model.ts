import type { FeedFilters, FeedItemAction, FeedItemView, FeedTier } from './types';

export const EMPTY_FILTERS: FeedFilters = {
  person: '',
  company: '',
  source: '',
  tag: '',
  region: '',
  mediaType: '',
};

export function filterFeedItems(items: FeedItemView[], filters: FeedFilters): FeedItemView[] {
  return items.filter((item) => (
    (!filters.person || item.persons.includes(filters.person)) &&
    (!filters.company || item.companies.includes(filters.company)) &&
    (!filters.source || item.sourceName === filters.source) &&
    (!filters.tag || item.tags.includes(filters.tag)) &&
    (!filters.region || item.region === filters.region) &&
    (!filters.mediaType || item.mediaType === filters.mediaType)
  ));
}

export function sortFeedItems(items: FeedItemView[]): FeedItemView[] {
  const tierRank: Record<FeedTier, number> = { highlight: 0, feed: 1, folded: 2 };
  return [...items].sort((a, b) => {
    const unread = Number(Boolean(a.readAt)) - Number(Boolean(b.readAt));
    if (unread !== 0) return unread;
    const tier = tierRank[a.tier] - tierRank[b.tier];
    if (tier !== 0) return tier;
    return Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
  });
}

export function splitFeed(items: FeedItemView[], filters: FeedFilters) {
  const filtered = sortFeedItems(filterFeedItems(items, filters));
  return {
    visible: filtered.filter((item) => item.tier !== 'folded'),
    folded: filtered.filter((item) => item.tier === 'folded'),
  };
}

export function feedOptions(items: FeedItemView[]) {
  const values = (input: string[]) => [...new Set(input.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return {
    persons: values(items.flatMap((item) => item.persons)),
    companies: values(items.flatMap((item) => item.companies)),
    sources: values(items.map((item) => item.sourceName)),
    tags: values(items.flatMap((item) => item.tags)),
  };
}

export function feedStats(items: FeedItemView[]) {
  return {
    total: items.length,
    unread: items.filter((item) => !item.readAt).length,
    highlights: items.filter((item) => item.tier === 'highlight').length,
    queued: items.filter((item) => item.archiveRequestedAt).length,
  };
}

export function applyLocalFeedAction(items: FeedItemView[], action: FeedItemAction): FeedItemView[] {
  return items.map((item) => {
    if (action.type === 'toggle_entity_star') {
      return {
        ...item,
        entities: item.entities.map((entity) => (
          entity.kind === action.entityKind && entity.name === action.entityName
            ? { ...entity, starred: action.starred }
            : entity
        )),
      };
    }
    if (item.id !== action.itemId) return item;
    switch (action.type) {
      case 'opened_source':
        return { ...item, readAt: item.readAt ?? action.at };
      case 'archive_requested':
        return { ...item, archiveRequestedAt: item.archiveRequestedAt ?? action.at };
      case 'irrelevant':
        return { ...item, tier: 'folded', readAt: item.readAt ?? action.at };
      case 'great':
        return { ...item, tier: 'highlight', readAt: item.readAt ?? action.at };
    }
  });
}
