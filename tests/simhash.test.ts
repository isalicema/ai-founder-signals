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

describe('⚠️ Postgres bigint 是有符号的', () => {
  const PG_MAX = 9223372036854775807n;
  const PG_MIN = -9223372036854775808n;

  it('⭐ 生成值永远落在 int8 区间内（实测未修前 46% 会溢出写不进库）', () => {
    for (let i = 0; i < 300; i += 1) {
      const h = cheapSimhash(`样本 ${i} `.repeat(20) + 'the quick brown fox jumps over the lazy dog');
      expect(h <= PG_MAX && h >= PG_MIN, `样本 ${i} 溢出：${h}`).toBe(true);
    }
  });

  // 注：近似文本的汉明距性质由文件上方那条用例覆盖，这里只验符号边界不出错。
  it('收进有符号区间后，自比仍为 0', () => {
    const a = cheapSimhash('创始人谈到团队最初做了七个功能入口。'.repeat(8));
    expect(hammingDistance(a, a)).toBe(0);
  });

  it('跨符号边界的两个值，汉明距不会算成负数或爆表', () => {
    const d = hammingDistance(-1n, 0n);
    expect(d).toBe(64);
  });
});
