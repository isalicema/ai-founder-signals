import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  UsageLedger, digestOf, costOf, isPeakWindow, llmProvider, __setProvider,
} from '../src/llm/provider.js';
import { safeJsonParse, DeepSeekProvider } from '../src/llm/deepseek.js';
import { createLlmJudge } from '../src/llm/judge.js';
import type { LlmProvider } from '../src/llm/types.js';

afterEach(() => { __setProvider(null); vi.unstubAllEnvs(); });

const RAW = '这是一段绝对不允许出现在任何日志或台账里的访谈正文原文内容。';

function stubProvider(dataSequence: unknown[]): LlmProvider {
  let i = 0;
  return {
    name: 'stub',
    modelFor: () => 'deepseek-v4-flash',
    completeJson: async () => ({
      data: dataSequence[Math.min(i++, dataSequence.length - 1)],
      inputTokens: 120, outputTokens: 30, model: 'deepseek-v4-flash',
    }),
  };
}

describe('⚠️ 红线：raw 不进日志、不进台账', () => {
  it('CallRecord 里只有摘要指纹，没有内容', async () => {
    const ledger = new UsageLedger();
    __setProvider(stubProvider([{ is_founder_interview: true, confidence: 0.9, reject_reason: '' }]));
    await createLlmJudge(ledger)({ title: '对谈某某某', snippet: RAW });

    const serialized = JSON.stringify(ledger.records) + ledger.summary();
    expect(serialized).not.toContain(RAW);
    expect(serialized).not.toContain('对谈某某某');
    expect(ledger.records[0]!.inputDigest).toHaveLength(12);
    expect(ledger.records[0]!.provider).toBe('stub');
  });

  it('llm/ 源码里没有打印内容的语句', () => {
    for (const f of ['provider', 'judge', 'summarize', 'deepseek', 'anthropic']) {
      const src = readFileSync(`src/llm/${f}.ts`, 'utf-8');
      expect(src, `${f}.ts 不应打印内容`).not.toMatch(/console\.(log|info|debug|warn)\s*\(/);
    }
  });
});

describe('供应商可替换（不与单一模型绑定）', () => {
  it('默认 DeepSeek，可切回 Anthropic', () => {
    expect(llmProvider().name).toBe('deepseek');
    __setProvider(null);
    vi.stubEnv('AFS_LLM_PROVIDER', 'anthropic');
    expect(llmProvider().name).toBe('anthropic');
  });

  it('默认模型 deepseek-v4-flash，env 可覆盖', () => {
    const p = new DeepSeekProvider({} as never);
    expect(p.modelFor('summary')).toBe('deepseek-v4-flash');
    vi.stubEnv('AFS_MODEL_SUMMARY', 'deepseek-v4-pro');
    expect(p.modelFor('summary')).toBe('deepseek-v4-pro');
  });
});

describe('DeepSeek 分时计价', () => {
  it('高峰按高价、平峰按低价', () => {
    const peak = new Date('2026-08-31T07:00:00Z');   // 周一 UTC 07:00 → 高峰
    const off = new Date('2026-08-31T22:00:00Z');    // 周一 UTC 22:00 → 平峰（我们的 cron）
    expect(isPeakWindow(peak)).toBe(true);
    expect(isPeakWindow(off)).toBe(false);
    expect(costOf('deepseek-v4-flash', 1_000_000, 0, peak)).toBe(0.44);
    expect(costOf('deepseek-v4-flash', 1_000_000, 0, off)).toBe(0.22);
  });

  it('周末全天平峰', () => {
    expect(isPeakWindow(new Date('2026-08-29T07:00:00Z'))).toBe(false);
  });

  it('⭐ 比 Haiku 便宜一个量级', () => {
    const ds = costOf('deepseek-v4-flash', 1_000_000, 200_000, new Date('2026-08-29T22:00:00Z'));
    const haiku = costOf('claude-haiku-4-5', 1_000_000, 200_000);
    expect(ds).toBeLessThan(haiku / 3);
  });

  it('未知模型记 0 而不是崩溃', () => {
    expect(costOf('unknown', 999, 999)).toBe(0);
  });
});

describe('DeepSeek 特有的失败模式', () => {
  it('⭐ 官方提示「可能偶尔返回空内容」→ 当失败重试，不当空对象', async () => {
    const ledger = new UsageLedger();
    __setProvider(stubProvider([undefined, { is_founder_interview: false, confidence: 0.1, reject_reason: '融资新闻' }]));
    const r = await createLlmJudge(ledger)({ title: 'x', snippet: 'y' });
    expect(ledger.records).toHaveLength(2);          // 重试了一次
    expect(ledger.records[1]!.retries).toBe(1);
    expect(r.is_founder_interview).toBe(false);
    expect(r.reject_reason).toBe('融资新闻');
  });

  it('重试仍失败 → 保守放行（召回优先，§0.4）', async () => {
    __setProvider(stubProvider([undefined]));
    const r = await createLlmJudge()({ title: 'x', snippet: 'y' });
    expect(r.is_founder_interview).toBe(true);
    expect(r.confidence).toBe(0.5);
  });

  it('结构不合 schema（缺字段 / confidence 越界）→ 重试而不是照单全收', async () => {
    __setProvider(stubProvider([{ confidence: 5 }, { is_founder_interview: true, confidence: 0.7 }]));
    const r = await createLlmJudge()({ title: 'x', snippet: 'y' });
    expect(r.confidence).toBe(0.7);
  });

  it('```json 围栏包裹也能解析', () => {
    expect(safeJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeJsonParse('好的，结果是：{"a":2} 以上。')).toEqual({ a: 2 });
    expect(safeJsonParse('完全不是 json')).toBeUndefined();
  });
});
