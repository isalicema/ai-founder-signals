import type { FeedFilters, FeedItemAction, FeedItemView, FeedTier } from './types';

export const EMPTY_FILTERS: FeedFilters = {
  person: '',
  company: '',
  source: '',
  tag: '',
  region: '',
  mediaType: '',
};

/** Feed 是未读收件箱；已阅条目留在数据库，但不再参与任何页面派生状态。 */
export function unreadFeedItems(items: FeedItemView[]): FeedItemView[] {
  return items.filter((item) => !item.readAt);
}

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

/**
 * ⚠️ 改成未读收件箱后 total 与 unread 恒等（只取未读），
 *    首屏两块大数字显示同一个数是浪费。新增 today：
 *    「今天新到的」和「积压的」是两回事，后者才是该清的。
 */
export function feedStats(items: FeedItemView[]) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return {
    total: items.length,
    unread: items.filter((item) => !item.readAt).length,
    today: items.filter((item) => new Date(item.firstSeenAt) >= dayStart).length,
    backlog: items.filter((item) => new Date(item.firstSeenAt) < dayStart).length,
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
    if (action.type === 'set_items_read') {
      return action.itemIds.includes(item.id) ? { ...item, readAt: action.readAt } : item;
    }
    if (item.id !== action.itemId) return item;
    switch (action.type) {
      case 'opened_source':
        return { ...item, readAt: item.readAt ?? action.at };
      case 'archive_requested':
        return { ...item, archiveRequestedAt: item.archiveRequestedAt ?? action.at };
      case 'irrelevant':
        return { ...item, tier: 'folded', readAt: item.readAt ?? action.at };
      case 'set_highlight':
        return {
          ...item,
          tier: action.highlighted ? 'highlight' : 'feed',
          readAt: action.highlighted ? item.readAt ?? action.at : item.readAt,
        };
    }
  });
}

/* ─────────────── 同一场对话的切片折叠 ─────────────── */

/** 与 data.ts 的密集受访角标用同一个判据，避免两处规则打架 */
export const SAME_CONVERSATION_MS = 3 * 24 * 60 * 60 * 1000;

export interface ConversationGroup {
  /** 代表条目：段落最长的那条，通常信息最全 */
  lead: FeedItemView;
  /** 其余切片，展开才显示。单条内容时为空数组 */
  rest: FeedItemView[];
}

function timeOf(item: FeedItemView): number {
  return Date.parse(item.publishedAt ?? item.firstSeenAt);
}

/**
 * 把同一场对话的切片折成一组。
 *
 * 由来：Lex Fridman 把一场 DHH 访谈切成 5 条视频分两天发布，feed 里就占了
 * 5 张卡、5 段高度重叠的摘要。在一个「30 秒扫完」的界面里这是实打实的噪音。
 *
 * 判据：同信源 + 至少共享一个人物 + 发布时间相差 3 天内。
 * 切片的字幕内容各不相同，simhash 去重从原理上挡不住，只能在这一层聚类。
 *
 * ⚠️ 只在**确实有 2 条以上**时才折叠。单条内容照常显示，不引入多余层级。
 */
export function groupConversations(items: FeedItemView[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  const buckets: FeedItemView[][] = [];

  for (const item of items) {
    const bucket = buckets.find((b) => b.some((other) =>
      other.sourceName === item.sourceName
      && Math.abs(timeOf(other) - timeOf(item)) <= SAME_CONVERSATION_MS
      && other.persons.some((p) => item.persons.includes(p))));
    if (bucket) bucket.push(item);
    else buckets.push([item]);
  }

  for (const bucket of buckets) {
    if (bucket.length === 1) {
      groups.push({ lead: bucket[0]!, rest: [] });
      continue;
    }
    // 代表选段落最长的那条：切片里内容最全的一段最能说明这场对话讲了什么
    const sorted = [...bucket].sort((a, b) =>
      (b.contentChars ?? 0) - (a.contentChars ?? 0) || timeOf(a) - timeOf(b));
    groups.push({ lead: sorted[0]!, rest: sorted.slice(1) });
  }

  // 保持原有排序：按代表条目在原列表中的位置
  const order = new Map(items.map((item, i) => [item.id, i]));
  return groups.sort((a, b) => (order.get(a.lead.id) ?? 0) - (order.get(b.lead.id) ?? 0));
}

/** 组内任一条未读，整组就算未读 */
export function groupUnread(group: ConversationGroup): boolean {
  return !group.lead.readAt || group.rest.some((item) => !item.readAt);
}
