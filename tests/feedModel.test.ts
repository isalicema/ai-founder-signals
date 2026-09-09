import { describe, expect, it } from 'vitest';
import { createDemoFeed } from '../src/feed/demo.js';
import type { FeedItemView } from '../src/feed/types.js';
import {
  applyLocalFeedAction,
  EMPTY_FILTERS,
  feedOptions,
  filterFeedItems,
  sortFeedItems,
  splitFeed,
  unreadFeedItems,
  feedStats,
  deepReadStats,
  mergeDeepReadHistory,
  obsidianNoteUrl,
} from '../src/feed/model.js';

const now = new Date('2026-08-29T08:00:00+08:00');
const demo = createDemoFeed(now).items;

describe('M5 feed model', () => {
  it('only creates local Obsidian links when both vault and note path are configured', () => {
    expect(obsidianNoteUrl('Research Vault', 'Research Notes/a b.md')).toBe(
      'obsidian://open?vault=Research%20Vault&file=Research%20Notes%2Fa%20b.md',
    );
    expect(obsidianNoteUrl(null, 'Research Notes/a.md')).toBeNull();
    expect(obsidianNoteUrl('Research Vault', null)).toBeNull();
    expect(obsidianNoteUrl('   ', 'Research Notes/a.md')).toBeNull();
  });

  it('filters by every §5 filter dimension without losing folded items globally', () => {
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, person: '肖弘' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, company: 'Perplexity' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, source: 'Y Combinator' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, tag: 'Agent' })).toHaveLength(2);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, region: '海外' })).toHaveLength(3);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, mediaType: 'podcast' })).toHaveLength(1);
    expect(splitFeed(demo, EMPTY_FILTERS).folded).toHaveLength(2);
  });

  it('keeps unread before read, then orders each signal tier by quality score', () => {
    const sorted = sortFeedItems(demo.filter((item) => item.tier !== 'folded'));
    expect(sorted.slice(0, 2).every((item) => item.tier === 'highlight')).toBe(true);
    expect(sorted[0]!.tierScore).toBeGreaterThan(sorted[1]!.tierScore!);
    const regular = sorted.filter((item) => item.tier === 'feed' && !item.readAt);
    expect(regular.map((item) => item.tierScore)).toEqual([0.62, 0.55]);
    expect(sorted.at(-1)?.readAt).not.toBeNull();
  });

  it('keeps unread backlog regardless of capture date and excludes newer read items', () => {
    const oldUnread = { ...demo[0]!, id: 'old-unread', firstSeenAt: '2026-08-25T00:00:00.000Z', readAt: null };
    const newRead = { ...demo[1]!, id: 'new-read', firstSeenAt: now.toISOString(), readAt: now.toISOString() };

    expect(unreadFeedItems([oldUnread, newRead]).map((item) => item.id)).toEqual(['old-unread']);
  });

  it('keeps an opened item in the unread inbox so follow-up actions remain available', () => {
    const target = demo.find((item) => !item.readAt)!;
    const opened = applyLocalFeedAction(demo, {
      type: 'opened_source',
      itemId: target.id,
      at: now.toISOString(),
    });
    expect(opened.find((item) => item.id === target.id)?.readAt).toBeNull();
    expect(unreadFeedItems(opened).some((item) => item.id === target.id)).toBe(true);
  });

  it('keeps quality feedback separate from tiers and restores folded content as a regular signal', () => {
    const at = now.toISOString();
    const demoted = applyLocalFeedAction(demo, { type: 'irrelevant', itemId: 'demo-perplexity-video', at });
    expect(demoted.find((item) => item.id === 'demo-perplexity-video')?.tier).toBe('folded');

    const restored = applyLocalFeedAction(demoted, {
      type: 'restore_signal',
      itemId: 'demo-perplexity-video',
      at,
    });
    expect(restored.find((item) => item.id === 'demo-perplexity-video')?.tier).toBe('feed');
    expect(restored.find((item) => item.id === 'demo-perplexity-video')?.readAt).toBeNull();
    expect(unreadFeedItems(restored).some((item) => item.id === 'demo-perplexity-video')).toBe(true);
    expect(splitFeed(unreadFeedItems(restored), EMPTY_FILTERS).visible.some((item) => item.id === 'demo-perplexity-video')).toBe(true);

    const praised = applyLocalFeedAction(restored, {
      type: 'great',
      itemId: 'demo-perplexity-video',
      at,
    });
    expect(praised.find((item) => item.id === 'demo-perplexity-video')).toEqual(
      restored.find((item) => item.id === 'demo-perplexity-video'),
    );

    const queued = applyLocalFeedAction(praised, { type: 'archive_requested', itemId: 'demo-perplexity-video', at });
    expect(queued.find((item) => item.id === 'demo-perplexity-video')?.archiveRequestedAt).toBe(at);
  });

  it('stars the same entity on every visible occurrence', () => {
    const repeated = [...demo, { ...demo[0]!, id: 'same-company-again' }];
    const starred = applyLocalFeedAction(repeated, {
      type: 'toggle_entity_star',
      itemId: demo[0]!.id,
      entityId: null,
      entityName: 'Manus',
      entityKind: 'company',
      starred: true,
      at: now.toISOString(),
    });
    const refs = starred.flatMap((item) => item.entities).filter((entity) => entity.name === 'Manus');
    expect(refs).toHaveLength(2);
    expect(refs.every((entity) => entity.starred)).toBe(true);
  });

  it('marks a scoped batch as read and restores only that batch on undo', () => {
    const itemIds = demo.filter((item) => !item.readAt).slice(0, 3).map((item) => item.id);
    const marked = applyLocalFeedAction(demo, {
      type: 'set_items_read',
      itemIds,
      readAt: now.toISOString(),
    });
    expect(marked.filter((item) => itemIds.includes(item.id)).every((item) => item.readAt === now.toISOString())).toBe(true);
    expect(marked.filter((item) => !itemIds.includes(item.id))).toEqual(demo.filter((item) => !itemIds.includes(item.id)));

    const restored = applyLocalFeedAction(marked, {
      type: 'set_items_read',
      itemIds,
      readAt: null,
    });
    expect(restored.filter((item) => itemIds.includes(item.id)).every((item) => item.readAt === null)).toBe(true);
  });

  it('builds deduplicated filter options', () => {
    const options = feedOptions(demo);
    expect(options.tags).toContain('产品与用户');
    expect(new Set(options.sources).size).toBe(options.sources.length);
  });

  it('keeps deep-read history after items leave the unread inbox and lets optimistic marks lead', () => {
    const archived = demo.find((item) => item.archivedAt)!;
    const fresh = { ...demo[1]!, archiveRequestedAt: now.toISOString() };
    const merged = mergeDeepReadHistory([archived], [fresh]);

    expect(merged.map((item) => item.id)).toEqual([fresh.id, archived.id]);
    expect(deepReadStats(merged)).toEqual({ total: 2, linked: 1, pending: 1, legacy: 0 });
  });
});

describe('未读收件箱的统计口径', () => {
  const at = (iso: string) => iso;
  const mk = (id: string, firstSeenAt: string, extra: Partial<FeedItemView> = {}): FeedItemView => ({
    id, title: id, url: `https://e.com/${id}`, sourceName: 'S', country: 'US', region: '海外',
    mediaType: 'video', publishedAt: null, firstSeenAt, durationSeconds: null, contentChars: null,
    coverUrl: null, summary: null, tags: [], persons: [], companies: [], entities: [],
    tierScore: 0.5, tier: 'feed', readAt: null, archiveRequestedAt: null, archivedAt: null, obsidianPath: null,
    status: 'ok', rejectReason: null,
    isNewEntity: false, monthlyMention: null, coverTone: 0, ...extra,
  });

  it('⭐ 区分「今天新到」与「积压」—— total 和 unread 恒等，两块大数字显示同一个数没意义', () => {
    const today = new Date(); today.setHours(9, 0, 0, 0);
    const older = new Date(today); older.setDate(older.getDate() - 3);
    const s = feedStats([mk('a', at(today.toISOString())), mk('b', at(older.toISOString()))]);
    expect(s.today).toBe(1);
    expect(s.backlog).toBe(1);
    expect(s.total).toBe(2);
    expect(s.unread).toBe(2);   // 收件箱里全是未读，所以两者相等
  });

  it('空收件箱不报错', () => {
    const s = feedStats([]);
    expect(s.today).toBe(0);
    expect(s.backlog).toBe(0);
  });
});
