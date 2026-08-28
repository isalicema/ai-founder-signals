export type EntityKind = 'person' | 'company';

/**
 * 归一化「尽力而为，不强求」（架构文档 §3.2）。
 *
 * 这里只产出用于**匹配**的 key，展示用的 canonical_name 永远保留首次见到的原始写法。
 * 灰色地带（中英文名、音译差异）不猜——同一个人先存成两行不致命，
 * Alice 在实体列表里手动合并即可。宁可漏合并，不可错合并。
 */

const COMPANY_SUFFIXES = [
  '有限公司', '股份有限公司', '科技有限公司', '信息技术有限公司',
  '公司', '科技', '智能', '网络',
];
const EN_COMPANY_SUFFIXES = [
  'inc.', 'inc', 'ltd.', 'ltd', 'llc', 'corp.', 'corp', 'co.', 'labs', 'lab',
  'technologies', 'technology', 'ai',
];

function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
          .replace(/　/g, ' ');
}

export function matchKey(raw: string, kind: EntityKind): string {
  let s = toHalfWidth(raw).trim().toLowerCase();

  // 去掉中文音译名里的间隔号与空白：山姆·奥特曼 → 山姆奥特曼
  s = s.replace(/[·•‧・]/g, '');
  // 去掉标点
  s = s.replace(/["'"'《》「」【】（）()\[\]]/g, '');

  if (kind === 'company') {
    for (const suf of COMPANY_SUFFIXES) {
      if (s.endsWith(suf) && s.length > suf.length) s = s.slice(0, -suf.length);
    }
    for (const suf of EN_COMPANY_SUFFIXES) {
      const re = new RegExp(`\\s+${suf.replace('.', '\\.')}$`);
      if (re.test(s) && s.replace(re, '').length > 1) s = s.replace(re, '');
    }
  }

  // 英文折叠多余空白；中文之间的空白直接去掉
  s = s.replace(/\s+/g, ' ').trim();
  if (/^[一-龥\s]+$/.test(s)) s = s.replace(/\s+/g, '');

  return s;
}

export interface EntityRow {
  kind: EntityKind;
  canonical_name: string;
  aliases: string[];
  mention_count: number;
}

/**
 * 把一次抽取到的名字并进 entity 表。
 * 返回 { row, isNew } —— isNew 就是卡片上 🆕 首次出现 badge 的依据。
 */
export function upsertEntity(
  existing: EntityRow[],
  kind: EntityKind,
  rawName: string,
): { row: EntityRow; isNew: boolean } {
  const key = matchKey(rawName, kind);
  if (!key) throw new Error(`empty entity name: ${JSON.stringify(rawName)}`);

  const hit = existing.find(
    (e) => e.kind === kind &&
      (matchKey(e.canonical_name, kind) === key || e.aliases.some((a) => matchKey(a, kind) === key)),
  );

  if (hit) {
    if (hit.canonical_name !== rawName && !hit.aliases.includes(rawName)) hit.aliases.push(rawName);
    hit.mention_count += 1;
    return { row: hit, isNew: false };
  }

  const row: EntityRow = { kind, canonical_name: rawName, aliases: [], mention_count: 1 };
  existing.push(row);
  return { row, isNew: true };
}
