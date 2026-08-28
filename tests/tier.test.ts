import { describe, it, expect } from 'vitest';
import { scoreTier, normalizeSourceWeight, WEIGHTS } from '../src/pipeline/tier/index.js';

describe('tier 分档', () => {
  it('好信源 + 强标题信号 → highlight', () => {
    const r = scoreTier({ sourceWeight: 0.9, titleSignal: 1.0, admissionConfidence: 1.0, entityStarred: false });
    expect(r.tier).toBe('highlight');
  });

  it('弱信号 → folded，但仍然入库（调用方负责不丢弃）', () => {
    const r = scoreTier({ sourceWeight: 0.2, titleSignal: 0, admissionConfidence: 0, entityStarred: false });
    expect(r.tier).toBe('folded');
  });

  it('tier_reason 可解释，四项都在', () => {
    const r = scoreTier({ sourceWeight: 0.5, titleSignal: 0.5, admissionConfidence: 0.5, entityStarred: true });
    expect(Object.keys(r.reason).sort()).toEqual(
      ['admissionConfidence', 'entityStarred', 'sourceWeight', 'titleSignal'],
    );
    expect(Object.values(r.reason).reduce((a, b) => a + b, 0)).toBeCloseTo(r.score, 4);
  });

  it('⭐ 星标权重不足以把新面孔挤下去（§0.5）', () => {
    // 陌生人 + 强标题信号 + 好信源
    const stranger = scoreTier({ sourceWeight: 0.9, titleSignal: 1.0, admissionConfidence: 1.0, entityStarred: false });
    // 星标人物 + 无标题信号 + 差信源
    const starred = scoreTier({ sourceWeight: 0.2, titleSignal: 0.3, admissionConfidence: 0.3, entityStarred: true });
    expect(stranger.score).toBeGreaterThan(starred.score);
    expect(WEIGHTS.entityStarred).toBeLessThan(WEIGHTS.titleSignal);
  });

  it('权重之和为 1', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 6);
  });

  it('source.weight 归一化', () => {
    expect(normalizeSourceWeight(0.2)).toBe(0);
    expect(normalizeSourceWeight(2.0)).toBe(1);
  });
});
