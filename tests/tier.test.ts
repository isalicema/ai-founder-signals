import { describe, it, expect } from 'vitest';
import {
  scoreTier, initialTier, displayTier, WEIGHTS, FULL_LENGTH_CHARS, FOLD_BELOW, HIGHLIGHT_AT,
} from '../src/pipeline/tier/index.js';

const perfect = { purity: 1, titleSignal: 1, admissionConfidence: 1, contentChars: 40_000 };
/** 现有信源里 purity 最高是 Founder Park 的 0.8 */
const full = { ...perfect, purity: 0.8 };

describe('分档打分（2026-08-29 改版）', () => {
  it('权重之和为 1', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('⭐ 满分可达 —— 旧公式实测最高只到 0.50，高亮档形同虚设', () => {
    expect(scoreTier(perfect).score).toBeCloseTo(1, 4);
    // 现实里最好的信源（purity 0.8）配强标题+完整正文能到 0.93，远高于旧公式的 0.50
    expect(scoreTier(full).score).toBeGreaterThan(0.9);
  });

  it('⭐ 长完整访谈排在短切片前面（真实数据回归）', () => {
    // Greg Isenberg WebMCP 55,838 字 vs Kantrowitz 切片 1,083 字，
    // 两者同信源档次、同为弱标题信号，唯一差别就是内容长度
    const base = { purity: 0.4, titleSignal: 0.3, admissionConfidence: 0.9 };
    const long = scoreTier({ ...base, contentChars: 55_838 });
    const clip = scoreTier({ ...base, contentChars: 1_083 });
    expect(long.score).toBeGreaterThan(clip.score);
    // 差距要够大到能改变排名——接近满额的充实度分
    expect(long.score - clip.score).toBeGreaterThan(0.15);
  });

  it('切片在其它维度也弱时会沉到折叠线以下', () => {
    // 折叠与否不只看长度：判定置信度低、信源 purity 低时才真的沉底
    const weak = scoreTier({ purity: 0.3, titleSignal: 0.3, admissionConfidence: 0.5, contentChars: 1_083 });
    expect(weak.score).toBeLessThan(FOLD_BELOW);
  });

  it('内容充实度到 2 万字封顶，不让超长内容无限加分', () => {
    const at = scoreTier({ ...full, contentChars: FULL_LENGTH_CHARS }).score;
    const over = scoreTier({ ...full, contentChars: FULL_LENGTH_CHARS * 5 }).score;
    expect(over).toBe(at);
  });

  it('contentChars 为 null 时不崩（被拒条目不抓正文）', () => {
    expect(() => scoreTier({ ...full, contentChars: null })).not.toThrow();
  });

  it('tier_reason 四项齐全且可解释', () => {
    const r = scoreTier(full);
    expect(Object.keys(r.reason).sort())
      .toEqual(['admissionConfidence', 'purity', 'substance', 'titleSignal']);
    expect(Object.values(r.reason).reduce((a, b) => a + b, 0)).toBeCloseTo(r.score, 4);
  });

  it('⭐ 被拒条目的判定置信度不能当正分（实测回归）', () => {
    // 被拒时 admissionConfidence 表示「确信它**不是**创始人访谈」。
    // 当正分加会让「判得最准的拒绝」得最高分——调用方必须传 0。
    const asPositive = scoreTier({ purity: 0.8, titleSignal: 1, admissionConfidence: 0.95, contentChars: null });
    const rejected = scoreTier({ purity: 0.8, titleSignal: 1, admissionConfidence: 0, contentChars: null });
    expect(rejected.score).toBeLessThan(asPositive.score);
    expect(rejected.reason.admissionConfidence).toBe(0);
  });

  it('入库只判够不够进 feed，不判高亮', () => {
    expect(initialTier(0.9)).toBe('feed');
    expect(initialTier(0.2)).toBe('folded');
  });
});

describe('固定质量线高亮', () => {
  it('⭐ 只有达到 0.65 的合格信号才高亮，不再强行凑 Top 3', () => {
    expect(HIGHLIGHT_AT).toBe(0.65);
    expect(displayTier({ tier: 'feed', tierScore: 0.65 })).toBe('highlight');
    expect(displayTier({ tier: 'feed', tierScore: 0.6499 })).toBe('feed');
  });

  it('⭐ folded 永远留在低分抽屉，即使历史分数异常偏高', () => {
    expect(displayTier({ tier: 'folded', tierScore: 0.9 })).toBe('folded');
  });

  it('历史手动 highlight 不能越过固定质量线', () => {
    expect(displayTier({ tier: 'highlight', tierScore: 0.53 })).toBe('feed');
    expect(displayTier({ tier: 'highlight', tierScore: 0.8 })).toBe('highlight');
  });

  it('tierScore 为 null 时作为普通合格信号呈现', () => {
    expect(displayTier({ tier: 'feed', tierScore: null })).toBe('feed');
  });
});
