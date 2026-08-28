import { describe, it, expect } from 'vitest';
import { extractEmbeddedNotes, MIN_NOTES_CHARS } from '../src/adapters/embeddedNotes.js';

const long = (s: string, n = 80) => s.repeat(n);

function nextData(payload: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

describe('内嵌 show notes 提取（按结构识别，不按域名）', () => {
  it('⭐ 从 __NEXT_DATA__ 取到单集说明', () => {
    const html = nextData({ props: { pageProps: { episode: {
      shownotes: `<p>${long('嘉宾背景与话题大纲。')}</p>`,
      podcast: { description: '节目通用简介，很短' },
    } } } });
    const notes = extractEmbeddedNotes(html);
    expect(notes).toBeTruthy();
    expect(notes!.length).toBeGreaterThan(MIN_NOTES_CHARS);
    expect(notes).not.toContain('<p>');           // HTML 标签已剥掉
    expect(notes).not.toContain('节目通用简介');   // 没错拿成节目简介
  });

  it('shownotes 优先于 description', () => {
    const html = nextData({ episode: {
      description: long('这是描述。'),
      shownotes: long('这是完整说明。'),
    } });
    expect(extractEmbeddedNotes(html)).toContain('完整说明');
  });

  it('只有 description 时也能用', () => {
    expect(extractEmbeddedNotes(nextData({ episode: { description: long('只有描述。') } })))
      .toContain('只有描述');
  });

  it('太短的说明不算数 —— 宁可 needs_body 也不拿一句话当正文', () => {
    expect(extractEmbeddedNotes(nextData({ episode: { description: '很短的一句话' } }))).toBeNull();
  });

  it('实体解码', () => {
    const html = nextData({ episode: { shownotes: long('他说&quot;这很难&quot;，A&amp;B。') } });
    const notes = extractEmbeddedNotes(html)!;
    expect(notes).toContain('"这很难"');
    expect(notes).toContain('A&B');
    expect(notes).not.toContain('&amp;');
  });

  it('og:description 兜底', () => {
    const html = `<html><head><meta property="og:description" content="${long('兜底说明。')}"></head></html>`;
    expect(extractEmbeddedNotes(html)).toContain('兜底说明');
  });

  it('没有可用内容时返回 null，不抛异常', () => {
    expect(extractEmbeddedNotes('<html><body>空页面</body></html>')).toBeNull();
    expect(extractEmbeddedNotes(nextData({ a: { b: { c: 1 } } }))).toBeNull();
    expect(() => extractEmbeddedNotes('<script id="__NEXT_DATA__">不是JSON</script>')).not.toThrow();
  });

  it('⭐ 源码里没有域名分支（HANDOFF 红线）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/adapters/embeddedNotes.ts', 'utf-8');
    expect(src).not.toMatch(/xiaoyuzhou|\.com['"]|hostname\s*===/);
  });
});
