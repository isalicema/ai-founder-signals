import { evaluateTitle, type TitleSignal } from './titleSignal.js';
import { evaluateStructural, type StructuralInput } from './structural.js';

export * from './keywords.js';
export * from './titleSignal.js';
export * from './structural.js';

/** L2 兜底判定的契约（架构文档 §4.2）——只看标题 + 前 500 字，不读全文 */
export interface AdmissionCheck {
  is_founder_interview: boolean;
  confidence: number;
  reject_reason?: string;
}
export type LlmJudge = (input: { title: string; snippet: string }) => Promise<AdmissionCheck>;

export interface AdmissionInput extends StructuralInput {
  title: string;
  /** 描述 / 摘要 / 正文前 500 字。列表阶段就能拿到，不需要下载全文 */
  snippet?: string;
  source: { purity: number; name?: string };
}

export interface AdmissionResult {
  accepted: boolean;
  /** 喂给 tier_score 的 title_signal 项（已乘结构性系数） */
  titleSignalScore: number;
  admissionConfidence: number;
  titleSignal: TitleSignal;
  structuralNotes: string[];
  llmUsed: boolean;
  rejectReason?: string;
  /** false 时不要下载正文——§4.1 的顺序调整就是为了省这一步 */
  shouldFetchBody: boolean;
}

/** purity 到这个值以上的信源，标题无信号也直接放行，省掉 L2 调用 */
export const HIGH_PURITY_THRESHOLD = 0.85;

/**
 * §4.0 三层准入漏斗。
 *
 * ⚠️ 关键性质：被拒的条目**仍然入库**（tier=folded），只是不下载正文、不生成摘要。
 *    永不丢弃，只降权——判定必然误判，丢掉不可逆、折叠可逆。
 */
export async function admit(input: AdmissionInput, llmJudge?: LlmJudge): Promise<AdmissionResult> {
  const titleSignal = evaluateTitle(input.title);
  const structural = evaluateStructural(input);
  const base = {
    titleSignal,
    structuralNotes: structural.notes,
    titleSignalScore: +(titleSignal.score * structural.factor).toFixed(4),
  };

  // L1 负向：直接折叠，不调 LLM、不抓正文
  if (titleSignal.verdict === 'negative') {
    return {
      ...base, accepted: false, admissionConfidence: 0, llmUsed: false,
      rejectReason: titleSignal.reason, shouldFetchBody: false,
    };
  }

  // ⚠️ 架构修正（2026-08-29，由 内容负责人 评测样本暴露）：
  //
  //   旧设计：L1 强正向 → 直接通过，不调 L2。
  //   为什么错：标题里的体裁词只能证明「这是一场访谈」，证明不了
  //             「受访者是 AI 创始人」——而后者是准入标准的另一半。
  //   反例：「对话 Gartner 分析师：企业 Agent 将如何重构 SaaS 市场」
  //         体裁强命中，但受访者是分析师不是创始人。L1 无法分辨。
  //
  //   新设计：体裁判定和身份判定分开。
  //     · 体裁靠规则（便宜、可解释）→ 喂给 tier_score
  //     · 身份靠 L2 或信源先验     → 决定放不放行
  //   成本影响可忽略：被判负的大头仍然不调 L2，那才是省钱的地方。

  // L0 信源先验：高纯度信源本身保证了受访对象，可跳过 L2
  // （身份存疑标记会剥夺这条快速通道）
  if (input.source.purity >= HIGH_PURITY_THRESHOLD && !titleSignal.requiresLlm) {
    return {
      ...base, accepted: true,
      admissionConfidence: +input.source.purity.toFixed(4),
      llmUsed: false, shouldFetchBody: true,
    };
  }

  // L2：由 LLM 判断受访者身份
  if (!llmJudge) {
    // 没有判官时保守放行——召回优先于精确（§0.4）。
    // ⚠️ 但身份存疑的不在此列：宁可让它进 folded，也不要把分析师访谈
    //    当创始人访谈推到 feed 顶部。
    if (titleSignal.requiresLlm) {
      return {
        ...base, accepted: false, admissionConfidence: 0, llmUsed: false,
        rejectReason: 'guest_role_ambiguous_no_judge', shouldFetchBody: false,
      };
    }
    return { ...base, accepted: true, admissionConfidence: 0.5, llmUsed: false, shouldFetchBody: true };
  }
  const verdict = await llmJudge({ title: input.title, snippet: (input.snippet ?? '').slice(0, 500) });
  return {
    ...base,
    accepted: verdict.is_founder_interview,
    admissionConfidence: verdict.confidence,
    llmUsed: true,
    rejectReason: verdict.is_founder_interview ? undefined : (verdict.reject_reason ?? 'llm_rejected'),
    shouldFetchBody: verdict.is_founder_interview,
  };
}
