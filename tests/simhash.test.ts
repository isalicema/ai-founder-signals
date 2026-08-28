import { describe, it, expect } from 'vitest';
import { cheapSimhash, hammingDistance } from '../src/worker/analyze.js';

describe('内容指纹（指纹留下，正文丢掉）', () => {
  const base = '创始人谈到团队最初做了七个功能入口，三个月后砍到一个，完成率从 12% 升到 41%。'.repeat(4);

  it('同文本同指纹', () => {
    expect(cheapSimhash(base)).toBe(cheapSimhash(base));
  });

  it('⭐ 近似文本汉明距小（转载改动少量文字仍能识别）', () => {
    const reposted = base.replace('创始人谈到', '据报道，创始人谈到');
    expect(hammingDistance(cheapSimhash(base), cheapSimhash(reposted))).toBeLessThanOrEqual(3);
  });

  it('不同文本汉明距大', () => {
    const other = '这是一篇完全不同主题的文章，讨论的是芯片制程与产能规划的问题。'.repeat(4);
    expect(hammingDistance(cheapSimhash(base), cheapSimhash(other))).toBeGreaterThan(3);
  });

  it('空白差异不影响', () => {
    expect(cheapSimhash(base)).toBe(cheapSimhash(base.replace(/。/g, '。\n  ')));
  });
});
