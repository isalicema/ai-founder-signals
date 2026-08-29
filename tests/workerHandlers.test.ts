import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleProcess, uniqueDiscoveredItems } from '../src/worker/handlers.js';
import { __setProvider } from '../src/llm/provider.js';
import { UsageLedger } from '../src/llm/provider.js';
import type { LlmProvider } from '../src/llm/types.js';

afterEach(() => __setProvider(null));

const SOURCE = {
  id: 's1', name: '测试源', url: 'https://e.com', country: 'CN', language: 'zh',
  ingestMethod: 'rss', fetchMode: 'full', weight: 1, weightLocked: false,
  purity: 0.5, enabled: true, lastCheckedAt: null, consecutiveFailures: 0,
};

function ctxWith(adapterFetch: ReturnType<typeof vi.fn>, inserted: unknown[]) {
  const chain = (rows: unknown[]) => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  });
  return {
    db: {
      select: (cols?: unknown) => chain(cols === undefined ? [SOURCE] : []),
      insert: () => ({ values: (row: unknown) => ({ onConflictDoNothing: () => { inserted.push(row); return Promise.resolve(); } }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    sql: Object.assign(() => Promise.resolve([]), { json: (v: unknown) => v }),
    registry: { forSource: () => ({ kinds: ['rss'], discover: vi.fn(), fetch: adapterFetch }) },
    ledger: new UsageLedger(),
  } as never;
}

const ITEM = {
  externalId: 'e1', url: 'https://e.com/a/1', title: '某公司完成 B 轮融资，红杉领投',
  publishedAt: null, mediaType: 'article' as const, admissionSnippet: '融资消息',
};

const stubJudge = (accept: boolean): LlmProvider => ({
  name: 'stub', modelFor: () => 'stub-model',
  completeJson: async () => ({
    data: { is_founder_interview: accept, confidence: 0.9, reject_reason: accept ? '' : 'not_interview' },
    inputTokens: 10, outputTokens: 5, model: 'stub-model',
  }),
});

describe('process 任务的两条不变量', () => {
  it('⭐ 被判 folded 的条目仍然入库，但绝不下载正文', async () => {
    const fetchSpy = vi.fn();
    const inserted: unknown[] = [];
    __setProvider(stubJudge(false));

    const result = await handleProcess(ctxWith(fetchSpy, inserted), { sourceId: 's1', item: ITEM as never });

    expect(result.outcome).toBe('folded');
    expect(fetchSpy, 'folded 条目不该抓正文').not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);                       // 永不丢弃
    const row = inserted[0] as Record<string, unknown>;
    expect(row.tier).toBe('folded');
    expect(row.summary).toBeUndefined();                    // 没花摘要的钱
    expect(row.rejectReason).toBeTruthy();                  // 留痕，供迭代词表
  });

  it('⭐ 融资标题被 L1 直接拦下，连 L2 都不调', async () => {
    const fetchSpy = vi.fn();
    const inserted: unknown[] = [];
    const provider = stubJudge(true);
    const spy = vi.spyOn(provider, 'completeJson');
    __setProvider(provider);

    await handleProcess(ctxWith(fetchSpy, inserted), { sourceId: 's1', item: ITEM as never });
    expect(spy, '融资新闻应在 L1 判负，不该花 L2 的钱').not.toHaveBeenCalled();
  });
});

describe('discover 任务的重复锚点收敛', () => {
  it('同一 externalId 只排一次，并保留第一个标题锚', () => {
    const first = { ...ITEM, title: '真正的文章标题' } as never;
    const excerpt = { ...ITEM, title: '卡片里的摘要文字' } as never;

    expect(uniqueDiscoveredItems([first, excerpt])).toEqual([first]);
  });
});
