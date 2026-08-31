import { describe, it, expect, vi } from 'vitest';
import { admit, type LlmJudge } from '../src/pipeline/admission/index.js';
import { POSITIVE, NEGATIVE } from '../tools/corpus.js';

/**
 * 准入评测集 —— 内容负责人 2026-08-29 定稿的 5 正 + 5 反。
 *
 * ⚠️ 这组用例的契约是「哪一层做了决定」，不是「LLM 桩答对了没」。
 *    断言 llmUsed 才能证明分层逻辑正确；只断言 accepted 会让桩的行为
 *    掩盖住 L1 的错误。
 */
const A = { mediaType: 'article' as const, contentChars: 9000 };
const judgeYes = () => vi.fn<LlmJudge>(async () => ({ is_founder_interview: true, confidence: 0.8 }));

describe('准入评测集（定稿）', () => {
  it('⭐ 5 条正例一条都不能被 L1 拒掉（召回优先，§0.4）', async () => {
    for (const c of POSITIVE) {
      const r = await admit({ title: c.t, ...A, source: { purity: c.purity } }, judgeYes());
      expect(r.accepted, c.t).toBe(true);
    }
  });

  it('⭐ 陌生创始人不被压低 —— 无回音室（§0.5）', async () => {
    // PostHog / Supabase 两条：标题无体裁词、公司也不是耳熟能详的
    for (const c of [POSITIVE[2]!, POSITIVE[3]!]) {
      const judge = judgeYes();
      const r = await admit({ title: c.t, ...A, source: { purity: c.purity } }, judge);
      expect(r.accepted).toBe(true);
      // 关键：它们必须走到 L2 被认真判断，而不是被 L1 判负
      expect(judge, c.t).toHaveBeenCalled();
    }
  });

  it('融资 / 榜单 / 发布：L1 直接判负，不花 L2 的钱', async () => {
    for (const c of [NEGATIVE[0]!, NEGATIVE[3]!, NEGATIVE[4]!]) {
      const judge = judgeYes();
      const r = await admit({ title: c.t, ...A, source: { purity: c.purity } }, judge);
      expect(r.accepted, c.t).toBe(false);
      expect(r.shouldFetchBody).toBe(false);
      expect(judge, `${c.kind} 不该走到 L2`).not.toHaveBeenCalled();
    }
  });

  it('⭐ 二手解读：「访谈的十个要点」是摘要不是访谈', async () => {
    const judge = judgeYes();
    const c = NEGATIVE[1]!;
    const r = await admit({ title: c.t, ...A, source: { purity: c.purity } }, judge);
    expect(r.accepted).toBe(false);
    expect(judge).not.toHaveBeenCalled();
  });

  it('⭐ 真访谈里的「要点」不能被二手解读规则误伤', async () => {
    // digest 规则用合取前瞻，靠的是"访谈的…要点"这种指代结构
    const r = await admit(
      { title: '对话某某某：AI 创业的三个要点', ...A, source: { purity: 0.5 } },
      judgeYes(),
    );
    expect(r.accepted).toBe(true);
  });

  it('⭐ 非创始人嘉宾：体裁强命中也不许 L1 独自放行，必须交 L2', async () => {
    const judge = judgeYes();
    const c = NEGATIVE[2]!;
    const r = await admit({ title: c.t, ...A, source: { purity: c.purity } }, judge);
    // 体裁判定仍然是强正向——「对话」确实是访谈体裁，这没判错
    expect(r.titleSignal.verdict).toBe('strong_positive');
    // 但身份存疑，L1 无权放行
    expect(r.titleSignal.requiresLlm).toBe(true);
    expect(judge, 'L1 不该独自放行分析师访谈').toHaveBeenCalled();
  });

  it('⭐ 身份存疑时，高纯度信源的快速通道也要被剥夺', async () => {
    const judge = judgeYes();
    await admit(
      { title: '专访某某教授：大模型的能力边界', ...A, source: { purity: 0.95 } },
      judge,
    );
    expect(judge, 'purity 再高也不能跳过身份判断').toHaveBeenCalled();
  });

  it('无 L2 判官时，身份存疑的宁可折叠也不误推到 feed', async () => {
    const r = await admit(
      { title: '对话 Gartner 分析师：企业 Agent 的未来', ...A, source: { purity: 0.5 } },
      undefined,
    );
    expect(r.accepted).toBe(false);
    expect(r.rejectReason).toBe('guest_role_ambiguous_no_judge');
  });
});
