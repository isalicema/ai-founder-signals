import { describe, it, expect } from 'vitest';
import { evaluateTitle } from '../src/pipeline/admission/titleSignal.js';

describe('L1 标题形态规则', () => {
  it('中文强正向体裁词命中', () => {
    for (const t of [
      '对谈 Manus 肖弘：我们为什么放弃了原来的产品',
      '晚点独家专访月之暗面杨植麟',
      '深度对话：一位 90 后创始人的两次转身',
      '万字长文｜和 Cursor 创始团队聊了三个小时',
      '某某某访谈实录',
      '创始人口述：我们是怎么活下来的',
    ]) {
      expect(evaluateTitle(t).verdict, t).toBe('strong_positive');
    }
  });

  it('「对话」要排掉技术术语用法', () => {
    expect(evaluateTitle('对话式 AI 的下一站在哪里').verdict).not.toBe('strong_positive');
    expect(evaluateTitle('多轮对话能力评测报告').verdict).not.toBe('strong_positive');
    expect(evaluateTitle('对话李彦宏：AI 原生应用还要多久').verdict).toBe('strong_positive');
  });

  it('英文强正向', () => {
    for (const t of [
      'Interview with the founder of Cognition',
      'Sam Altman sits down with Lex',
      'In conversation with the Perplexity team',
      'Dario Amodei on building Anthropic',
    ]) {
      expect(evaluateTitle(t).verdict, t).toBe('strong_positive');
    }
  });

  it('硬负向压过一切，包括强正向', () => {
    const r = evaluateTitle('2026 年度 AI 创业者榜单：50 位创始人深度访谈盘点');
    expect(r.verdict).toBe('negative');
    expect(r.reason).toContain('hard_negative');
  });

  it('强正向压过软负向 —— 「对话X：为什么拒绝融资」是访谈不是融资新闻', () => {
    const r = evaluateTitle('对话某某某：我们为什么拒绝了这轮融资');
    expect(r.verdict).toBe('strong_positive');
  });

  it('纯新闻标题判为 negative', () => {
    for (const t of [
      '某某公司宣布完成 B 轮融资，红杉领投',
      'Anthropic raises $2B at $60B valuation',
      'OpenAI launches new reasoning model',
    ]) {
      expect(evaluateTitle(t).verdict, t).toBe('negative');
    }
  });

  it('无信号标题返回 none 而不是 negative', () => {
    expect(evaluateTitle('关于 AI 的一些零散思考').verdict).toBe('none');
  });

  it('YouTube 嘉宾分隔符形态算弱正向', () => {
    expect(evaluateTitle('Building the future of agents | Jane Doe, Acme').verdict).toBe('weak_positive');
  });
});
