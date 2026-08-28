import { describe, it, expect } from 'vitest';
import { matchKey, upsertEntity, type EntityRow } from '../src/pipeline/entity/normalize.js';

describe('entity 归一化（尽力而为，宁可漏合并不可错合并）', () => {
  it('中文音译名去间隔号', () => {
    expect(matchKey('山姆·奥特曼', 'person')).toBe(matchKey('山姆奥特曼', 'person'));
  });

  it('英文大小写与空白', () => {
    expect(matchKey('  Sam  Altman ', 'person')).toBe(matchKey('sam altman', 'person'));
  });

  it('公司后缀剥离', () => {
    expect(matchKey('月之暗面科技', 'company')).toBe(matchKey('月之暗面', 'company'));
    expect(matchKey('Perplexity AI', 'company')).toBe(matchKey('Perplexity', 'company'));
  });

  it('不跨语言瞎猜：中英文名保持两行，等人工合并', () => {
    expect(matchKey('Sam Altman', 'person')).not.toBe(matchKey('山姆奥特曼', 'person'));
  });

  it('⭐ 首次出现返回 isNew=true —— 这是卡片上 🆕 badge 的依据', () => {
    const rows: EntityRow[] = [];
    expect(upsertEntity(rows, 'company', 'Zylo').isNew).toBe(true);
    expect(upsertEntity(rows, 'company', 'Zylo').isNew).toBe(false);
    expect(rows[0]!.mention_count).toBe(2);
  });

  it('别名自动累积', () => {
    const rows: EntityRow[] = [];
    upsertEntity(rows, 'person', 'Sam Altman');
    upsertEntity(rows, 'person', 'sam altman');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aliases).toContain('sam altman');
  });
});
