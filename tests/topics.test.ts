import { describe, it, expect } from 'vitest';
import { TOPICS, sanitizeTags, isTopic, MAX_TAGS } from '../src/pipeline/topics.js';

describe('主题闭集（定稿）', () => {
  it('15 个主题，无重复', () => {
    expect(TOPICS).toHaveLength(15);
    expect(new Set(TOPICS).size).toBe(15);
  });

  it('已移除的旧标签不再合法', () => {
    for (const gone of ['融资与资本', '中国与全球市场', '组织与招聘', 'AI 安全与治理', '创始人经历', '产品哲学']) {
      expect(isTopic(gone), gone).toBe(false);
    }
  });

  it('丢弃集合外的 tag 并留痕', () => {
    const r = sanitizeTags(['Agent', '大模型创业', '商业模式']);
    expect(r.tags).toEqual(['Agent', '商业模式']);
    expect(r.dropped).toEqual(['大模型创业']);   // 持续出现同一个非法 tag = prompt 该调
  });

  it('去重并截断到上限', () => {
    expect(sanitizeTags(['Agent', 'Agent']).tags).toEqual(['Agent']);
    expect(sanitizeTags([...TOPICS]).tags).toHaveLength(MAX_TAGS);
  });

  it('脏输入不炸', () => {
    for (const bad of [null, undefined, 'Agent', 42, [null, '', 7, 'Agent']]) {
      expect(() => sanitizeTags(bad)).not.toThrow();
    }
    expect(sanitizeTags([null, '', 7, 'Agent']).tags).toEqual(['Agent']);
  });
});
