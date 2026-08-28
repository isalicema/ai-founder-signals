import { normalizeText } from './html.js';

/**
 * 从页面内嵌的 JSON 数据里提取节目/单集说明（show notes）。
 *
 * 由来：实测小宇宙不提供逐字稿，播客全部落在 needs_body。但它的单集页在
 * __NEXT_DATA__ 里带了完整 shownotes——张小珺那一集有 8074 字，含嘉宾背景
 * 和带时间戳的 OUTLINE。**对我们的用途，show notes 甚至比逐字稿更好**：
 * 已经结构化过，没有口语废话，判定和摘要都够用。
 *
 * ⚠️ 这里按**数据结构**识别，不按域名——不许出现 host 分支（HANDOFF 红线）。
 *    任何把内容嵌进 __NEXT_DATA__/__NUXT__ 的站点都能命中。
 */

const EMBEDDED_JSON_PATTERNS = [
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  /<script[^>]*>\s*window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i,
];

/** 越靠前优先级越高 */
const NOTE_KEYS = ['shownotes', 'showNotes', 'description', 'summary', 'content'];

export const MIN_NOTES_CHARS = 300;

export function extractEmbeddedNotes(html: string, minChars = MIN_NOTES_CHARS): string | null {
  for (const pattern of EMBEDDED_JSON_PATTERNS) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    let data: unknown;
    try {
      data = JSON.parse(match[1].trim().replace(/;$/, ''));
    } catch {
      continue;
    }
    const best = bestNote(data, minChars);
    if (best) return best;
  }

  // 兜底：og:description 有时也够长
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const text = og?.[1] ? normalizeText(stripTags(decodeEntities(og[1]))) : '';
  return text.length >= minChars ? text : null;
}

function bestNote(root: unknown, minChars: number): string | null {
  const found: Array<{ rank: number; text: string }> = [];

  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || found.length > 40) return;
    if (Array.isArray(node)) {
      for (const child of node.slice(0, 20)) walk(child, depth + 1);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const rank = NOTE_KEYS.indexOf(key);
      if (rank >= 0 && typeof value === 'string') {
        const text = normalizeText(stripTags(decodeEntities(value)));
        if (text.length >= minChars) found.push({ rank, text });
      }
      walk(value, depth + 1);
    }
  };
  walk(root, 0);

  if (found.length === 0) return null;
  // 先按字段优先级，同级取最长的那份
  found.sort((a, b) => a.rank - b.rank || b.text.length - a.text.length);
  return found[0]!.text;
}

function stripTags(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
