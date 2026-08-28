import { describe, it, expect } from 'vitest';
import { evaluateTitle } from '../src/pipeline/admission/titleSignal.js';

/**
 * 真实标题回归集 —— 2026-08-29 从实际信源 RSS 抓取。
 * 合成用例证明不了规则在真实数据上的行为，这一组才是。
 */
describe('真实标题回归集', () => {
  it('中文媒体：体裁词是强约定，规则有效', () => {
    expect(evaluateTitle('对话与爱为舞张怀亭：大哥创业不走弯路').verdict).toBe('strong_positive');
  });

  it('⚠️ 误报回归：AI Interviews 是产品名，不是「这条是访谈」', () => {
    // 实测发现的误报。裸 /interviews?/ 会把 YC 这条判成访谈
    expect(evaluateTitle('How Outset Turned AI Interviews Into a New Category').verdict)
      .not.toBe('strong_positive');
    // 但真正的访谈体裁仍要命中
    expect(evaluateTitle('An interview with the founder of Cognition').verdict).toBe('strong_positive');
    expect(evaluateTitle('Interview: Sam Altman on scaling').verdict).toBe('strong_positive');
  });

  it('英文创始人访谈的两个高置信形态', () => {
    expect(evaluateTitle('How Olivier Pomel Built Datadog By Refusing Every Shortcut').verdict)
      .toBe('weak_positive');
    expect(evaluateTitle('How AI Should Handle News and Medicine — With Campbell Brown').verdict)
      .toBe('weak_positive');
  });

  it('新闻汇总类正确判负', () => {
    expect(evaluateTitle('Software’s Epic Comeback, Meta’s AI Layoffs Blunder').verdict)
      .toBe('negative');
  });

  it('⭐ 结构性事实：英文 YouTube 标题多数不含体裁信号，必须靠 L2 兜底', () => {
    // 这些都是真实的创始人/深度内容，但标题看不出体裁——记录现状，不是缺陷
    const noSignal = [
      'Supabase: Cash Does Not Equal Success',
      'PostHog: Pivots Were The Real Lesson In Building A Startup',
      'Can Bootstrapped Founders Still Win?',
      'Brex was a VR headset company',
    ];
    for (const t of noSignal) {
      expect(['none', 'weak_positive']).toContain(evaluateTitle(t).verdict);
    }
  });
});
