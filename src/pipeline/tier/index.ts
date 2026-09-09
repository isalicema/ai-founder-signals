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

/** 低于这条线的直接折叠；达到后进入 Signal Stream。 */
export const FOLD_BELOW = 0.35;

/** 高亮是稀缺的质量标记，不是必须填满的展示席位。 */
export const HIGHLIGHT_AT = 0.65;

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

/** 入库时只判「够不够格进 Signal Stream」；高亮在展示时由固定质量线派生。 */
export function initialTier(score: number): Tier {
  return score >= FOLD_BELOW ? 'feed' : 'folded';
}

/**
 * 将数据库里的工作流 tier 转成页面呈现 tier。
 * folded 永远留在低分抽屉；其余信号只有达到固定质量线才显示为高亮。
 * 历史手动写入的 highlight 不再越过质量线，避免用户反馈与算法标签混用。
 */
export function displayTier(item: { tier: Tier; tierScore: number | null }): Tier {
  if (item.tier === 'folded') return 'folded';
  return (item.tierScore ?? 0) >= HIGHLIGHT_AT ? 'highlight' : 'feed';
}
