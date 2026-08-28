import { access } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { processItem } from '../src/worker/processItem.js';

const baseInput = {
  mediaType: 'article' as const,
  title: '一家 AI 公司宣布完成 A 轮融资',
  snippet: '公司今日宣布完成融资。',
  source: { purity: 0.4 },
};

describe('processItem', () => {
  it('persists folded metadata without fetching or summarizing', async () => {
    const insertFolded = vi.fn().mockResolvedValue(undefined);
    const fetchAndAnalyze = vi.fn();
    const insertAccepted = vi.fn();

    const result = await processItem(baseInput, { insertFolded, fetchAndAnalyze, insertAccepted });

    expect(result.outcome).toBe('folded');
    expect(insertFolded).toHaveBeenCalledOnce();
    expect(insertFolded.mock.calls[0]?.[0]).toMatchObject({
      tier: 'folded',
      isFounderInterview: false,
      summary: null,
    });
    expect(fetchAndAnalyze).not.toHaveBeenCalled();
    expect(insertAccepted).not.toHaveBeenCalled();
  });

  it('runs accepted body work inside a temporary directory and cleans it before insert', async () => {
    let workspace = '';
    const insertAccepted = vi.fn(async () => {
      await expect(access(workspace)).rejects.toThrow();
    });

    const result = await processItem(
      { ...baseInput, title: '对谈一家陌生 AI 公司的创始人' },
      {
        insertFolded: vi.fn(),
        fetchAndAnalyze: vi.fn(async (directory: string) => {
          workspace = directory;
          await expect(access(directory)).resolves.toBeUndefined();
          return {
            summary: '创始人讨论了产品取舍与市场进入路径。',
            tags: ['产品哲学', '商业模式', '中国与全球市场'],
            persons: ['测试创始人'],
            companies: ['测试公司'],
            modelVersion: 'test-model',
          };
        }),
        insertAccepted,
      },
    );

    expect(result.outcome).toBe('accepted');
    expect(insertAccepted).toHaveBeenCalledOnce();
  });
});
