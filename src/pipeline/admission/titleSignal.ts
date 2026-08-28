import { RULES, GUEST_SEPARATOR, type Rule, type RuleKind } from './keywords.js';

export type TitleVerdict = 'strong_positive' | 'weak_positive' | 'negative' | 'none';

export interface TitleSignal {
  verdict: TitleVerdict;
  /** 0-1，喂给 tier_score 的 title_signal 项 */
  score: number;
  matched: Array<{ id: string; kind: RuleKind; text: string }>;
  /**
   * 受访者身份存疑 —— 与 verdict 正交。
   * verdict 回答「是不是访谈体裁」，这个旗标回答「能不能确定受访者是创始人」。
   * true 时 L1 无权独自放行，必须交 L2。
   */
  requiresLlm: boolean;
  /** 判为 negative 时的说明，用于迭代词表（架构文档 §4.0） */
  reason?: string;
}

/**
 * 优先级设计（这是个真实的取舍，不是实现细节）：
 *
 *   hard_negative  >  strong_positive  >  soft_negative  >  weak_positive  >  none
 *
 * 为什么 strong_positive 压过 soft_negative：
 *   「对话XX：为什么我们拒绝了融资」是访谈，不是融资新闻。
 *   soft_negative 那批词是用来抓「新闻报道」的，一旦标题已经自报体裁是对谈，
 *   体裁信号更可信。
 *
 * 为什么 hard_negative 压过一切：
 *   榜单/盘点/招聘/财报 这类几乎不可能真的是一手访谈，放进来纯是噪音。
 */
export function evaluateTitle(title: string): TitleSignal {
  const matched: TitleSignal['matched'] = [];
  const byKind: Record<RuleKind, Rule[]> = {
    strong_positive: [], weak_positive: [], hard_negative: [], soft_negative: [], needs_llm: [],
  };

  for (const rule of RULES) {
    const m = title.match(rule.pattern);
    if (m) {
      matched.push({ id: rule.id, kind: rule.kind, text: m[0] });
      byKind[rule.kind].push(rule);
    }
  }

  const requiresLlm = byKind.needs_llm.length > 0;

  if (byKind.hard_negative.length > 0) {
    return {
      verdict: 'negative', score: 0, matched, requiresLlm,
      reason: `hard_negative: ${byKind.hard_negative.map(r => r.id).join(',')}`,
    };
  }
  if (byKind.strong_positive.length > 0) {
    return { verdict: 'strong_positive', score: 1.0, matched, requiresLlm };
  }
  if (byKind.soft_negative.length > 0) {
    return {
      verdict: 'negative', score: 0, matched, requiresLlm,
      reason: `soft_negative: ${byKind.soft_negative.map(r => r.id).join(',')}`,
    };
  }
  if (byKind.weak_positive.length > 0 || GUEST_SEPARATOR.test(title)) {
    if (GUEST_SEPARATOR.test(title)) {
      matched.push({ id: 'fmt.guest_separator', kind: 'weak_positive', text: '|' });
    }
    return { verdict: 'weak_positive', score: 0.5, matched, requiresLlm };
  }
  return { verdict: 'none', score: 0.3, matched, requiresLlm };
}
