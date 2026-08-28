import { describe, it, expect, vi } from 'vitest';
import { admit, type LlmJudge } from '../src/pipeline/admission/index.js';

const src = (purity: number) => ({ purity, name: 'test' });
const article = { mediaType: 'article' as const, contentChars: 12000 };

describe('§4.0 三层准入漏斗', () => {
  it('强正向不调用 LLM', async () => {
    const judge = vi.fn<LlmJudge>();
    const r = await admit({ title: '对谈某某某：Agent 的交付难题', ...article, source: src(0.5) }, judge);
    expect(r.accepted).toBe(true);
    expect(r.llmUsed).toBe(false);
    expect(judge).not.toHaveBeenCalled();
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
    expect(r.admissionConfidence).toBe(1.0);
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
