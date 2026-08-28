import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { UsageLedger, digestOf, costOf, modelFor, __setClient } from '../src/llm/provider.js';
import { createLlmJudge } from '../src/llm/judge.js';

afterEach(() => __setClient(null));

const RAW = '这是一段绝对不允许出现在任何日志或台账里的访谈正文原文内容。';

describe('⚠️ 红线：raw 不进日志、不进台账', () => {
  it('CallRecord 里只有摘要指纹，没有内容', async () => {
    const ledger = new UsageLedger();
    __setClient({
      messages: {
        parse: async () => ({
          parsed_output: { is_founder_interview: true, confidence: 0.9, reject_reason: '' },
          usage: { input_tokens: 120, output_tokens: 30 },
        }),
      },
    } as never);

    const judge = createLlmJudge(ledger);
    await judge({ title: '对谈某某某', snippet: RAW });

    const serialized = JSON.stringify(ledger.records) + ledger.summary();
    expect(serialized).not.toContain(RAW);
    expect(serialized).not.toContain('对谈某某某');
    expect(ledger.records[0]!.inputDigest).toHaveLength(12);
    expect(ledger.records[0]!.costUsd).toBeGreaterThan(0);
  });

  it('provider 源码里没有打印内容的语句', () => {
    for (const f of ['src/llm/provider.ts', 'src/llm/judge.ts', 'src/llm/summarize.ts']) {
      const src = readFileSync(f, 'utf-8');
      expect(src, `${f} 不应打印内容`).not.toMatch(/console\.(log|info|debug|warn)\s*\(/);
    }
  });

  it('digest 稳定且不可反推', () => {
    expect(digestOf(RAW)).toBe(digestOf(RAW));
    expect(digestOf(RAW)).not.toContain('访谈');
  });
});

describe('模型可替换（不与单一模型绑定）', () => {
  it('环境变量可覆盖，默认值来自架构文档的成本决策', () => {
    expect(modelFor('summary')).toBe('claude-haiku-4-5');
    vi.stubEnv('AFS_MODEL_SUMMARY', 'claude-sonnet-5');
    expect(modelFor('summary')).toBe('claude-sonnet-5');
    vi.unstubAllEnvs();
  });

  it('成本按模型计价，未知模型记 0 而不是崩溃', () => {
    expect(costOf('claude-haiku-4-5', 1_000_000, 0)).toBe(1);
    expect(costOf('claude-opus-5', 0, 1_000_000)).toBe(25);
    expect(costOf('unknown-model', 999, 999)).toBe(0);
  });
});

describe('判定失败时的保守行为', () => {
  it('结构化解析失败 → 保守放行（召回优先，§0.4）', async () => {
    __setClient({
      messages: { parse: async () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }) },
    } as never);
    const r = await createLlmJudge()({ title: 't', snippet: 's' });
    expect(r.is_founder_interview).toBe(true);
    expect(r.confidence).toBe(0.5);
  });
});
