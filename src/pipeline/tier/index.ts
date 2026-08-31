export type Tier = 'highlight' | 'feed' | 'folded';

/**
 * 打分维度。
 *
 * ⚠️ 2026-08-29 修订：原先第一项是 source.weight，那是设计给**反馈学习**用的，
 *    用户看完首批 50 条后明确不做反馈调权（信源已经少而精，只看卡片本身质量）。
 *    于是 weight 永远是默认的 1.0，占比最大的一项退化成常数，
 *    实测最高分只到 0.50 而高亮门槛是 0.65——**高亮档根本不可能触发**。
 *
 *    改用 source.purity：那是你逐个信源手调过的质量判断
 *    （Founder Park 0.8、Acquired 0.15），本来就是质量信号，却一直没进公式。
 *    同时新增「内容充实度」，用来区分完整深访与正片切片。
 */
export interface TierInput {
  /** source.purity（0-1）：这个信源大概几成是创始人一手访谈 */
  purity: number;
  /** §4.0 产出的 title_signal（已含结构性系数） */
  titleSignal: number;
  admissionConfidence: number;
  /** 正文/字幕字数。区分「完整深访」与「正片切片」的唯一可靠信号 */
  contentChars: number | null;
}

/** 与 db/schema.ts 的 TierReason 结构一致——每项都必须在，缺一项就调不了参 */
export interface TierReason {
  purity: number;
  titleSignal: number;
  admissionConfidence: number;
  substance: number;
  [key: string]: number;
}

export interface TierResult {
  score: number;
  /** 存进 item.tier_reason —— 调参时要看得见是哪一项在起作用，不做黑盒 */
  reason: TierReason;
}

export const WEIGHTS = {
  purity: 0.35,
  titleSignal: 0.25,
  admissionConfidence: 0.20,
  substance: 0.20,
} as const;

/** 到这个字数就算「完整一场」。实测完整访谈 15k-55k 字，切片 1k-2k 字 */
export const FULL_LENGTH_CHARS = 20_000;

/** 低于这条线的直接折叠。高亮不再用绝对分数，见 pickHighlights */
export const FOLD_BELOW = 0.35;

/** 每天高亮几场。绝对门槛会「有的天 0 条、有的天 20 条」，相对排名每天都有意义 */
export const HIGHLIGHT_COUNT = 3;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreTier(input: TierInput): TierResult {
  const parts: TierReason = {
    purity: WEIGHTS.purity * clamp01(input.purity),
    titleSignal: WEIGHTS.titleSignal * clamp01(input.titleSignal),
    admissionConfidence: WEIGHTS.admissionConfidence * clamp01(input.admissionConfidence),
    substance: WEIGHTS.substance * clamp01((input.contentChars ?? 0) / FULL_LENGTH_CHARS),
  };
  const score = +Object.values(parts).reduce((a, b) => a + b, 0).toFixed(4);
  return { score, reason: parts };
}

/** 入库时只判「够不够格进 feed」；高亮是展示时按当天排名决定的 */
export function initialTier(score: number): Tier {
  return score >= FOLD_BELOW ? 'feed' : 'folded';
}

/**
 * 从当天可见条目里挑出高亮。
 *
 * 为什么不用绝对门槛：实测最高分 0.64、门槛 0.65 → 一条都不高亮；
 * 门槛降到 0.55 又可能哪天冒出二十条。对每天都看的 feed，
 * 「今天最值得先看的 3 场」永远有意义，「分数超过某个数」看运气。
 */
export function pickHighlights<T extends { id: string; tierScore: number | null; tier: Tier }>(
  items: T[],
  count = HIGHLIGHT_COUNT,
): Set<string> {
  return new Set(
    [...items]
      // ⚠️ 必须先排除 folded，光看分数不够——被拒条目也有分数，
      //    而且拒绝判得越准分越高。实测把两条「受访者不是创始人」顶进了高亮。
      .filter((item) => item.tier !== 'folded' && (item.tierScore ?? 0) >= FOLD_BELOW)
      .sort((a, b) => (b.tierScore ?? 0) - (a.tierScore ?? 0))
      .slice(0, count)
      .map((item) => item.id),
  );
}
