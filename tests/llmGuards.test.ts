import { describe, it, expect } from 'vitest';
import { findQuotedSpeech, stripQuotedSpeech, checkSummary } from '../src/llm/guards.js';

describe('引文守卫（prompt 是请求，代码才是保证）', () => {
  it('抓出中英文长引号原话', () => {
    for (const s of [
      '他谈到组织问题，"我们花了整整一年才想明白该招什么人"，随后调整了结构。',
      '创始人说「最难的不是技术而是取舍这件事」，这是全场最有信息量的一句。',
      'He argued that "the hard part is distribution, not the model itself" repeatedly.',
    ]) {
      expect(findQuotedSpeech(s).length, s).toBeGreaterThan(0);
      expect(checkSummary(s).ok).toBe(false);
    }
  });

  it('短引号是产品名/术语，不算原话', () => {
    for (const s of [
      '团队把「Agent」定义为可完成任务的产品入口，而不是聊天框。',
      'They call it "copilot" internally.',
    ]) {
      expect(findQuotedSpeech(s), s).toHaveLength(0);
      expect(checkSummary(s).ok).toBe(true);
    }
  });

  it('⭐ 兜底摘除：宁可摘要少一句，也不留假原话', () => {
    const out = stripQuotedSpeech('他谈到组织，"我们花了整整一年才想明白该招什么人"，随后调整了结构。');
    expect(findQuotedSpeech(out)).toHaveLength(0);
    expect(out).toContain('他谈到组织');
    expect(out).toContain('随后调整了结构');
  });

  it('长度只警告不拦截（中英文摘要字数天然不同）', () => {
    expect(checkSummary('太短').lengthWarning).toContain('too_short');
    expect(checkSummary('字'.repeat(800)).lengthWarning).toContain('too_long');
    expect(checkSummary('字'.repeat(200)).lengthWarning).toBeNull();
    expect(checkSummary('太短').ok).toBe(true);   // 长度不影响 ok
  });
});
