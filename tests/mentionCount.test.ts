import { describe, it, expect } from 'vitest';
import { countMentions } from '../src/feed/data.js';

const at = (iso: string) => new Date(iso);
const row = (persons: string[], sourceId: string, published: string) => ({
  persons, companies: null, sourceId,
  publishedAt: at(published), firstSeenAt: at(published),
});

describe('密集受访角标：数对话，不数条目', () => {
  it('⭐ Lex 把一场 DHH 访谈切成 5 条分两天发 → 算 1 场（真实数据回归）', () => {
    const counts = countMentions([
      row(['DHH'], 'lex', '2026-08-27T10:00:00Z'),
      row(['DHH'], 'lex', '2026-08-27T12:00:00Z'),
      row(['DHH'], 'lex', '2026-08-28T09:00:00Z'),
      row(['DHH'], 'lex', '2026-08-28T10:00:00Z'),
      row(['DHH'], 'lex', '2026-08-28T11:00:00Z'),
    ]);
    expect(counts.get('DHH')).toBe(1);
  });

  it('⭐ 加上另一个信源的独立一场 → 算 2 场（实测真值）', () => {
    const counts = countMentions([
      row(['DHH'], 'lex', '2026-08-27T10:00:00Z'),
      row(['DHH'], 'lex', '2026-08-28T10:00:00Z'),
      row(['DHH'], 'lex', '2026-08-28T11:00:00Z'),
      row(['DHH'], 'kuaguo', '2026-08-27T00:00:00Z'),
    ]);
    expect(counts.get('DHH')).toBe(2);
    // 阈值是 >2 才显示角标，所以 DHH 这轮不该出现「本月第 N 场」
    expect(counts.get('DHH')!).toBeLessThanOrEqual(2);
  });

  it('同一信源隔了很久的两次访谈算两场', () => {
    const counts = countMentions([
      row(['某某'], 'a', '2026-07-01T00:00:00Z'),
      row(['某某'], 'a', '2026-08-01T00:00:00Z'),
    ]);
    expect(counts.get('某某')).toBe(2);
  });

  it('真正的密集发声仍然数得出来', () => {
    const counts = countMentions([
      row(['密集'], 'a', '2026-08-01T00:00:00Z'),
      row(['密集'], 'b', '2026-08-08T00:00:00Z'),
      row(['密集'], 'c', '2026-08-15T00:00:00Z'),
      row(['密集'], 'd', '2026-08-22T00:00:00Z'),
    ]);
    expect(counts.get('密集')).toBe(4);
  });

  it('没有发布日期时退回首见时间，不崩', () => {
    const counts = countMentions([
      { persons: ['无日期'], companies: null, sourceId: 'a',
        publishedAt: null, firstSeenAt: at('2026-08-29T00:00:00Z') },
    ]);
    expect(counts.get('无日期')).toBe(1);
  });
});
