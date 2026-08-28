export type Tier = 'highlight' | 'feed' | 'folded';

export interface TierInput {
  /** source.weight 归一化到 0-1（weight 定义域 0.2-2.0） */
  sourceWeight: number;
  /** §4.0 产出的 title_signal（已含结构性系数） */
  titleSignal: number;
  admissionConfidence: number;
  /** 命中 Alice 事后打过星的人物/公司 */
  entityStarred: boolean;
}

export interface TierResult {
  tier: Tier;
  score: number;
  /** 存进 item.tier_reason —— 调参时要看得见是哪一项在起作用，不做黑盒 */
  reason: Record<string, number>;
}

export const WEIGHTS = {
  sourceWeight: 0.35,
  titleSignal: 0.30,
  admissionConfidence: 0.20,
  /** ⚠️ 故意压低：星标是微调不是主导，不能重到把新面孔挤下去（§0.5） */
  entityStarred: 0.15,
} as const;

export const THRESHOLDS = { highlight: 0.65, feed: 0.35 } as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** source.weight (0.2-2.0) → 0-1 */
export function normalizeSourceWeight(weight: number): number {
  return clamp01((weight - 0.2) / 1.8);
}

export function scoreTier(input: TierInput): TierResult {
  const parts = {
    sourceWeight: WEIGHTS.sourceWeight * clamp01(input.sourceWeight),
    titleSignal: WEIGHTS.titleSignal * clamp01(input.titleSignal),
    admissionConfidence: WEIGHTS.admissionConfidence * clamp01(input.admissionConfidence),
    entityStarred: WEIGHTS.entityStarred * (input.entityStarred ? 1 : 0),
  };
  const score = +Object.values(parts).reduce((a, b) => a + b, 0).toFixed(4);
  const tier: Tier =
    score >= THRESHOLDS.highlight ? 'highlight' : score >= THRESHOLDS.feed ? 'feed' : 'folded';
  return { tier, score, reason: parts };
}
