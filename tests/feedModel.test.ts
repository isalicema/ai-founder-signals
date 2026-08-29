import { describe, expect, it } from 'vitest';
import { createDemoFeed } from '../src/feed/demo.js';
import {
  applyLocalFeedAction,
  EMPTY_FILTERS,
  feedOptions,
  filterFeedItems,
  sortFeedItems,
  splitFeed,
} from '../src/feed/model.js';

const now = new Date('2026-08-29T08:00:00+08:00');
const demo = createDemoFeed(now).items;

describe('M5 feed model', () => {
  it('filters by every §5 filter dimension without losing folded items globally', () => {
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, person: '肖弘' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, company: 'Perplexity' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, source: 'Y Combinator' })).toHaveLength(1);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, tag: 'Agent' })).toHaveLength(2);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, region: '海外' })).toHaveLength(3);
    expect(filterFeedItems(demo, { ...EMPTY_FILTERS, mediaType: 'podcast' })).toHaveLength(1);
    expect(splitFeed(demo, EMPTY_FILTERS).folded).toHaveLength(2);
  });

  it('keeps unread before read, then highlight before regular feed', () => {
    const sorted = sortFeedItems(demo.filter((item) => item.tier !== 'folded'));
    expect(sorted.slice(0, 2).every((item) => item.tier === 'highlight')).toBe(true);
    expect(sorted.at(-1)?.readAt).not.toBeNull();
  });

  it('moves feedback actions through tiers and keeps folded content recoverable', () => {
    const at = now.toISOString();
    const demoted = applyLocalFeedAction(demo, { type: 'irrelevant', itemId: 'demo-perplexity-video', at });
    expect(demoted.find((item) => item.id === 'demo-perplexity-video')?.tier).toBe('folded');

    const restored = applyLocalFeedAction(demoted, {
      type: 'set_highlight',
      itemId: 'demo-perplexity-video',
      highlighted: true,
      at,
    });
    expect(restored.find((item) => item.id === 'demo-perplexity-video')?.tier).toBe('highlight');

    const unhighlighted = applyLocalFeedAction(restored, {
      type: 'set_highlight',
      itemId: 'demo-perplexity-video',
      highlighted: false,
      at,
    });
    expect(unhighlighted.find((item) => item.id === 'demo-perplexity-video')?.tier).toBe('feed');

    const queued = applyLocalFeedAction(unhighlighted, { type: 'archive_requested', itemId: 'demo-perplexity-video', at });
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
});
