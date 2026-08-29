import { describe, it, expect } from 'vitest';
import { groupConversations, groupUnread } from '../src/feed/model.js';
import type { FeedItemView } from '../src/feed/types.js';

const item = (o: Partial<FeedItemView> & { id: string }): FeedItemView => ({
  title: o.id, url: `https://e.com/${o.id}`, sourceName: 'Lex Fridman',
  country: 'US', region: '海外', mediaType: 'video',
  publishedAt: '2026-08-28T10:00:00Z', firstSeenAt: '2026-08-29T00:00:00Z',
  durationSeconds: null, contentChars: 1000, coverUrl: null, summary: 's',
  tags: [], persons: ['DHH'], companies: [], entities: [],
  tier: 'feed', readAt: null, archiveRequestedAt: null, status: 'ok',
  rejectReason: null, isNewEntity: false, monthlyMention: null, coverTone: 0,
  ...o,
});

describe('同一场对话的切片折叠', () => {
  it('⭐ Lex 的 5 条 DHH 切片折成 1 组（真实数据回归）', () => {
    const groups = groupConversations([
      item({ id: 'a', contentChars: 18286, publishedAt: '2026-08-27T10:00:00Z' }),
      item({ id: 'b', contentChars: 6621, publishedAt: '2026-08-27T12:00:00Z' }),
      item({ id: 'c', contentChars: 15868, publishedAt: '2026-08-28T09:00:00Z' }),
      item({ id: 'd', contentChars: 9569, publishedAt: '2026-08-28T10:00:00Z' }),
      item({ id: 'e', contentChars: 18131, publishedAt: '2026-08-28T11:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rest).toHaveLength(4);
    expect(groups[0]!.lead.id).toBe('a');          // 段落最长的那条当代表
  });

  it('不同信源的同一人不合并 —— 那是两场对话', () => {
    const groups = groupConversations([
      item({ id: 'lex', sourceName: 'Lex Fridman' }),
      item({ id: 'kua', sourceName: '跨国串门计划' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('同信源同人但隔了很久 → 两场', () => {
    const groups = groupConversations([
      item({ id: 'jul', publishedAt: '2026-07-01T00:00:00Z' }),
      item({ id: 'aug', publishedAt: '2026-08-01T00:00:00Z' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('同信源同期但没有共同人物 → 不合并', () => {
    const groups = groupConversations([
      item({ id: 'x', persons: ['DHH'] }),
      item({ id: 'y', persons: ['别人'] }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('⭐ 单条内容不引入多余层级', () => {
    const groups = groupConversations([item({ id: 'solo' })]);
    expect(groups[0]!.rest).toEqual([]);
  });

  it('保持原有排序（未读优先等排序在上游已做）', () => {
    const groups = groupConversations([
      item({ id: '1', persons: ['A'] }),
      item({ id: '2', persons: ['B'] }),
      item({ id: '3', persons: ['C'] }),
    ]);
    expect(groups.map((g) => g.lead.id)).toEqual(['1', '2', '3']);
  });

  it('组内任一条未读，整组算未读', () => {
    const read = '2026-08-29T01:00:00Z';
    expect(groupUnread({
      lead: item({ id: 'a', readAt: read }),
      rest: [item({ id: 'b', readAt: null })],
    })).toBe(true);
    expect(groupUnread({
      lead: item({ id: 'a', readAt: read }),
      rest: [item({ id: 'b', readAt: read })],
    })).toBe(false);
  });

  it('没有发布日期时退回首见时间，不崩', () => {
    const groups = groupConversations([
      item({ id: 'a', publishedAt: null }),
      item({ id: 'b', publishedAt: null }),
    ]);
    expect(groups).toHaveLength(1);   // 首见时间相同 → 同一组
  });
});
