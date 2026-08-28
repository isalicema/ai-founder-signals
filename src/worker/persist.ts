import { and, eq, gte, inArray } from 'drizzle-orm';
import type { AfsDatabase } from '../db/client.js';
import { entities, items } from '../db/schema.js';
import { matchKey, type EntityKind } from '../pipeline/entity/normalize.js';
import { hammingDistance } from './analyze.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIMHASH_NEAR_DUPLICATE = 3;

export interface EntityOutcome {
  /** 归一化后的规范名，写进 item.persons / item.companies */
  canonical: string[];
  /** 有任一实体是首次出现 → 卡片上的 🆕 角标 */
  anyNew: boolean;
  /** 命中 Alice 事后打过星的实体 → tier_score 的 entityStarred 项 */
  anyStarred: boolean;
}

/**
 * 把抽取到的人名/公司名并进 entity 表。
 *
 * ⚠️ 这张表由系统自动生长，不需要事先提供名单（架构文档 §0.5）。
 *    归一化尽力而为——同一个人先存成两行不致命，Alice 可以事后手动合并；
 *    宁可漏合并，不可错合并。
 */
export async function upsertEntities(
  db: AfsDatabase,
  kind: EntityKind,
  rawNames: string[],
): Promise<EntityOutcome> {
  const names = [...new Set(rawNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return { canonical: [], anyNew: false, anyStarred: false };

  const existing = await db.select().from(entities).where(eq(entities.kind, kind));
  const index = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    index.set(matchKey(row.canonicalName, kind), row);
    for (const alias of row.aliases) index.set(matchKey(alias, kind), row);
  }

  const canonical: string[] = [];
  let anyNew = false;
  let anyStarred = false;
  const now = new Date();

  for (const name of names) {
    const hit = index.get(matchKey(name, kind));
    if (hit) {
      canonical.push(hit.canonicalName);
      if (hit.starred) anyStarred = true;
      const aliases = hit.canonicalName === name || hit.aliases.includes(name)
        ? hit.aliases
        : [...hit.aliases, name];
      await db.update(entities)
        .set({ mentionCount: hit.mentionCount + 1, lastSeenAt: now, aliases })
        .where(eq(entities.id, hit.id));
    } else {
      canonical.push(name);
      anyNew = true;
      await db.insert(entities)
        .values({ kind, canonicalName: name, aliases: [], mentionCount: 1, lastSeenAt: now })
        .onConflictDoNothing();
    }
  }
  return { canonical, anyNew, anyStarred };
}

/**
 * 去重 L2：同一天内 simhash 汉明距 ≤3 视为纯转载（架构文档 §6.1）。
 * L1（url_canonical 唯一）由数据库约束负责，这里只处理内容近似。
 */
export async function findNearDuplicate(
  db: AfsDatabase,
  simhash: bigint,
  publishedAt: Date | null,
): Promise<string | null> {
  const since = new Date((publishedAt ?? new Date()).getTime() - THIRTY_DAYS_MS);
  const candidates = await db
    .select({ id: items.id, simhash: items.simhash })
    .from(items)
    .where(gte(items.firstSeenAt, since));

  for (const row of candidates) {
    if (row.simhash === null) continue;
    if (hammingDistance(simhash, row.simhash) <= SIMHASH_NEAR_DUPLICATE) return row.id;
  }
  return null;
}

/** 已存在的 external_id，discover 阶段用来跳过——省掉后续所有开销 */
export async function existingExternalIds(
  db: AfsDatabase,
  sourceId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ externalId: items.externalId })
    .from(items)
    .where(and(eq(items.sourceId, sourceId), inArray(items.externalId, ids)));
  return new Set(rows.map((r) => r.externalId).filter((v): v is string => v !== null));
}
