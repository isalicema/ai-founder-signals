import { describe, it, expect, vi } from 'vitest';
import { classify } from '../src/worker/run.js';
import { AdapterError, FetchBlockedError } from '../src/adapters/errors.js';
import { serializeItem, deserializeItem } from '../src/worker/handlers.js';

describe('异常分类（绝不泄漏异常原文）', () => {
  it('AdapterError 用它自己的安全码', () => {
    expect(classify(new AdapterError('fetch_timeout', { retryable: true }))).toBe('fetch_timeout');
    expect(classify(new FetchBlockedError('article_body_missing'))).toBe('article_body_missing');
  });

  it('⭐ 未知异常只记 unclassified_error，不带消息内容', () => {
    const leak = new Error('连接失败：正文片段 创始人说我们花了一年才想明白该招什么人');
    const code = classify(leak);
    expect(code).toBe('unclassified_error');
    expect(code).not.toContain('创始人');
    expect(code).not.toContain('正文');
  });
});

describe('任务载荷序列化', () => {
  it('Date 往返不丢', () => {
    const at = new Date('2026-08-29T10:00:00Z');
    const item = {
      externalId: 'x1', url: 'https://e.com/a/1', title: 't',
      publishedAt: at, mediaType: 'article' as const,
    };
    const round = deserializeItem(JSON.parse(JSON.stringify(serializeItem(item))));
    expect(round.publishedAt?.toISOString()).toBe(at.toISOString());
    expect(round.externalId).toBe('x1');
  });

  it('publishedAt 为 null 时保持 null（列表页常拿不到日期）', () => {
    const round = deserializeItem(serializeItem({
      externalId: 'x', url: 'https://e.com/a', title: 't',
      publishedAt: null, mediaType: 'article',
    }));
    expect(round.publishedAt).toBeNull();
  });
});

describe('管线错误码可定位（实测回归）', () => {
  it('⭐ summarize_parse_failed 不再被记成 unclassified_error', async () => {
    const { SummarizeError } = await import('../src/llm/summarize.js');
    expect(classify(new SummarizeError('summarize_parse_failed'))).toBe('summarize_parse_failed');
  });

  it('Postgres SQLSTATE 记成 db_XXXXX', () => {
    expect(classify(Object.assign(new Error('x'), { code: '22003' }))).toBe('db_22003');
  });

  it('带内容的裸异常仍然只记 unclassified_error', () => {
    expect(classify(new Error('创始人说我们花了一年'))).toBe('unclassified_error');
  });
});

describe('发现期截止（实测回归）', () => {
  it('默认 7 天，env 可覆盖', async () => {
    const { discoveryMaxAgeDays } = await import('../src/worker/handlers.js');
    expect(discoveryMaxAgeDays()).toBe(7);
    vi.stubEnv('AFS_DISCOVERY_MAX_AGE_DAYS', '30');
    expect(discoveryMaxAgeDays()).toBe(30);
    vi.stubEnv('AFS_DISCOVERY_MAX_AGE_DAYS', '不是数字');
    expect(discoveryMaxAgeDays()).toBe(7);   // 脏值回落默认，不崩
    vi.unstubAllEnvs();
  });
});
