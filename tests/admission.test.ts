import { describe, it, expect, vi } from 'vitest';
import { admit, evaluateStructural, type LlmJudge } from '../src/pipeline/admission/index.js';

const src = (purity: number) => ({ purity, name: 'test' });
const article = { mediaType: 'article' as const, contentChars: 12000 };

describe('§4.0 三层准入漏斗', () => {
  // ⚠️ 2026-08-29 架构修正：强正向不再跳过 L2。
  //    标题体裁词只能证明「这是访谈」，证明不了「受访者是创始人」。
  //    省钱的地方在负向判定（那才是大头），不在放行侧。
  it('强正向仍然要交 L2 判断受访者身份', async () => {
    const judge = vi.fn<LlmJudge>(async () => ({ is_founder_interview: true, confidence: 0.9 }));
    const r = await admit({ title: '对谈某某某：Agent 的交付难题', ...article, source: src(0.5) }, judge);
    expect(r.accepted).toBe(true);
    expect(judge).toHaveBeenCalled();
    // 体裁判定本身仍是强正向，只是不再独自决定放行
    expect(r.titleSignal.verdict).toBe('strong_positive');
    expect(r.titleSignalScore).toBe(1.0);
  });

  it('负向不调用 LLM、也不抓正文', async () => {
    const judge = vi.fn<LlmJudge>();
    const r = await admit({ title: '某公司完成 A 轮融资', ...article, source: src(0.5) }, judge);
    expect(r.accepted).toBe(false);
    expect(r.shouldFetchBody).toBe(false);   // §4.1：省抓取、省 token
    expect(judge).not.toHaveBeenCalled();
    expect(r.rejectReason).toBeTruthy();      // 留痕，用于迭代词表
  });

  it('高纯度信源在无标题信号时跳过 LLM', async () => {
    const judge = vi.fn<LlmJudge>();
    const r = await admit({ title: '一些零散的行业观察', ...article, source: src(0.9) }, judge);
    expect(r.accepted).toBe(true);
    expect(judge).not.toHaveBeenCalled();
  });

  it('低纯度信源 + 无信号才走 L2，且只喂 500 字', async () => {
    const judge = vi.fn<LlmJudge>(async () => ({ is_founder_interview: true, confidence: 0.8 }));
    const r = await admit(
      { title: '一些零散的行业观察', snippet: 'x'.repeat(2000), ...article, source: src(0.4) },
      judge,
    );
    expect(r.llmUsed).toBe(true);
    expect(judge.mock.calls[0]?.[0].snippet.length).toBe(500);
    expect(r.admissionConfidence).toBe(0.8);
  });

  it('⭐ 无回音室：完全陌生的创始人和公司照样通过（v2.1 §0.5）', async () => {
    const r = await admit(
      { title: '对话 Zylo 创始人陈某某：我们在做一件没人看好的事', ...article, source: src(0.5) },
      undefined,
    );
    expect(r.accepted).toBe(true);
    // 无判官时保守放行（0.5），而不是 L1 自信直判——召回优先（§0.4）
    expect(r.admissionConfidence).toBe(0.5);
  });

  it('没有 LLM 判官时保守放行 —— 召回优先于精确（§0.4）', async () => {
    const r = await admit({ title: '随便一个标题', ...article, source: src(0.4) }, undefined);
    expect(r.accepted).toBe(true);
  });

  it('短视频降权但不排除', async () => {
    const r = await admit(
      { title: '对谈某某某', mediaType: 'video', durationSeconds: 300, source: src(0.5) },
      undefined,
    );
    expect(r.accepted).toBe(true);
    expect(r.titleSignalScore).toBeLessThan(1.0);
    expect(r.structuralNotes.join()).toContain('short_media');
  });
});

describe('⚠️ 结构性降权：实测漏洞回归', () => {
  it('⭐ YouTube RSS 不给时长，短切片只能靠字幕字数识别', async () => {
    // 发现阶段：只有标题，没有时长也没有字数 → 降权不生效，正常放行
    const atDiscovery = await admit(
      { title: 'Is Your Chatbot Conscious?', mediaType: 'video', source: src(0.4) },
      undefined,
    );
    expect(atDiscovery.structuralNotes).toHaveLength(0);

    // 抓完字幕：1083 字的切片 → 必须降权
    const afterFetch = evaluateStructural({ mediaType: 'video', contentChars: 1083 });
    expect(afterFetch.factor).toBeLessThan(1);
    expect(afterFetch.notes.join()).toContain('short_body');
  });

  it('完整访谈的字幕长度不降权', () => {
    expect(evaluateStructural({ mediaType: 'video', contentChars: 40000 }).factor).toBe(1);
  });

  it('时长与字数同时偏短 → 叠加降权', () => {
    const r = evaluateStructural({ mediaType: 'video', durationSeconds: 180, contentChars: 800 });
    expect(r.factor).toBeCloseTo(0.36, 5);
    expect(r.notes).toHaveLength(2);
  });
});
