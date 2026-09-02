import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setProvider, type LlmProvider } from '../src/llm/provider.js';
import { summarizeItem } from '../src/llm/summarize.js';

const english = {
  summary: 'This interview explains how DHH uses AI agents to review pull requests and why he believes most programmers produce weak code.',
  tags: ['Agent', '组织与人才', '开源'],
  persons: ['DHH'],
  companies: ['37signals'],
};

const chinese = {
  summary: 'DHH 讨论了 AI Agent 如何改变开源协作。他用 Agent 预审 pull request，自己保留最终合并判断，并认为这种分工能让非程序员更容易把创意变成可运行的软件；这些判断主要来自其个人项目经验，能否普遍适用仍需验证。',
  tags: ['Agent', '组织与人才', '开源'],
  persons: ['DHH'],
  companies: ['37signals'],
};

function providerWith(summaries: Array<typeof english>): LlmProvider {
  let index = 0;
  return {
    name: 'test',
    modelFor: () => 'test-summary',
    completeJson: vi.fn(async () => ({
      data: summaries[Math.min(index++, summaries.length - 1)],
      inputTokens: 100,
      outputTokens: 50,
      model: 'test-summary',
    })),
  };
}

afterEach(() => __setProvider(null));

describe('海外信源中文摘要', () => {
  it('英文摘要会带纠偏提示重试，标题和实体名不需要翻译', async () => {
    const provider = providerWith([english, chinese]);
    __setProvider(provider);

    const result = await summarizeItem({
      title: 'Most Programmers Suck: DHH Explains',
      sourceName: 'Lex Fridman',
      body: 'English transcript body.',
      provenance: 'transcript',
    });

    expect(result.summary).toBe(chinese.summary);
    expect(result.persons).toEqual(['DHH']);
    expect(result.warnings).toContain('summary_language_retry');
    expect(provider.completeJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(provider.completeJson).mock.calls[0]?.[0].system).toContain('必须使用简体中文');
    expect(vi.mocked(provider.completeJson).mock.calls[1]?.[0].system).toContain('英文只保留人名');
  });

  it('连续返回英文时拒绝入库，不静默接受', async () => {
    __setProvider(providerWith([english]));
    await expect(summarizeItem({
      title: 'English interview',
      sourceName: 'Overseas source',
      body: 'English transcript body.',
    })).rejects.toMatchObject({ code: 'summary_language_failed' });
  });
});
