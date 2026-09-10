import { desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { sharedDb } from '../db/shared';
import { entities, feedback, items, sources } from '../db/schema';
import { createDemoFeed } from './demo';
import { displayTier } from '../pipeline/tier/index';
import type {
  FeedEntityRef,
  FeedItemView,
  FeedMediaType,
  FeedPayload,
  FeedPreference,
  FeedTier,
  MonthlyMention,
} from './types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** 未读收件箱一次最多取多少条。到顶说明积压太久，该清一次而不是继续堆 */
export const UNREAD_LIMIT = 200;
export const HISTORY_LIMIT = 300;
const NEW_ENTITY_WINDOW_MS = 60 * 60 * 1000;

const feedItemSelection = {
  id: items.id,
  title: items.title,
  url: items.url,
  mediaType: items.mediaType,
  publishedAt: items.publishedAt,
  firstSeenAt: items.firstSeenAt,
  durationSeconds: items.durationSeconds,
  contentChars: items.contentChars,
  coverUrl: items.coverUrl,
  summary: items.summary,
  tags: items.tags,
  persons: items.persons,
  companies: items.companies,
  tier: items.tier,
  tierScore: items.tierScore,
  readAt: items.readAt,
  archiveRequestedAt: items.archiveRequestedAt,
  archivedAt: items.archivedAt,
  obsidianPath: items.obsidianPath,
  status: items.status,
  rejectReason: items.rejectReason,
  sourceName: sources.name,
  country: sources.country,
};

/**
 * Database reads stay opt-in until M7 authentication lands. This keeps an
 * accidentally deployed M5 preview from exposing the private feed.
 */
export async function loadFeed(): Promise<FeedPayload> {
  if (process.env.AFS_FEED_DATA_MODE !== 'database') return createDemoFeed();
  if (!process.env.SUPABASE_DB_URL) {
    return { ...createDemoFeed(), notice: '缺少 SUPABASE_DB_URL，当前显示演示数据' };
  }

  const connection = sharedDb();
  try {
    const latestPreference = connection.db
      .selectDistinctOn([feedback.itemId], {
        itemId: feedback.itemId,
        signal: feedback.signal,
      })
      .from(feedback)
      .where(inArray(feedback.signal, ['like', 'dislike']))
      .orderBy(feedback.itemId, desc(feedback.createdAt), desc(feedback.id))
      .as('latest_preference');
    const selection = {
      ...feedItemSelection,
      preferenceSignal: latestPreference.signal,
    };
    const [rows, historyRows, entityRows, recentRows] = await Promise.all([
      connection.db
        .select(selection)
        .from(items)
        .innerJoin(sources, eq(items.sourceId, sources.id))
        .leftJoin(latestPreference, eq(items.id, latestPreference.itemId))
        .where(isNull(items.readAt))
        .orderBy(desc(items.firstSeenAt))
        // ⚠️ 未读收件箱没有日期边界，必须有上限兜底。
        //    按每天约 50 条入库估，出差一周回来就是几百条——
        //    既拖慢渲染，也直接违背「30 秒扫完」。
        //    到顶时前端会提示，让人去「全部标为已阅」而不是默默截断。
        .limit(UNREAD_LIMIT),
      connection.db
        .select(selection)
        .from(items)
        .innerJoin(sources, eq(items.sourceId, sources.id))
        .leftJoin(latestPreference, eq(items.id, latestPreference.itemId))
        .where(isNotNull(items.archiveRequestedAt))
        .orderBy(desc(items.archiveRequestedAt))
        .limit(HISTORY_LIMIT),
      connection.db
        .select({
          id: entities.id,
          kind: entities.kind,
          canonicalName: entities.canonicalName,
          firstSeenAt: entities.firstSeenAt,
          starred: entities.starred,
        })
        .from(entities),
      connection.db
        .select({
          persons: items.persons,
          companies: items.companies,
          sourceId: items.sourceId,
          publishedAt: items.publishedAt,
          firstSeenAt: items.firstSeenAt,
        })
        .from(items)
        .where(gte(items.firstSeenAt, new Date(Date.now() - THIRTY_DAYS_MS))),
    ]);

    const entityIndex = new Map(entityRows.map((entity) => [
      `${entity.kind}:${entity.canonicalName}`,
      entity,
    ]));
    const mentionCounts = countMentions(recentRows);

    const toFeedItem = (row: (typeof rows)[number]): FeedItemView => {
      const persons = row.persons ?? [];
      const companies = row.companies ?? [];
      const itemEntities: FeedEntityRef[] = [
        ...persons.map((name) => entityRef('person', name, entityIndex)),
        ...companies.map((name) => entityRef('company', name, entityIndex)),
      ];
      const firstSeenTime = row.firstSeenAt.getTime();
      const isNewEntity = itemEntities.some((entity) => {
        const record = entityIndex.get(`${entity.kind}:${entity.name}`);
        return record && Math.abs(record.firstSeenAt.getTime() - firstSeenTime) <= NEW_ENTITY_WINDOW_MS;
      });

      return {
        id: row.id,
        title: row.title,
        url: row.url,
        sourceName: row.sourceName,
        country: row.country,
        region: row.country === 'CN' ? '国内' : '海外',
        mediaType: mediaType(row.mediaType),
        publishedAt: row.publishedAt?.toISOString() ?? null,
        firstSeenAt: row.firstSeenAt.toISOString(),
        durationSeconds: row.durationSeconds,
        contentChars: row.contentChars,
        coverUrl: row.coverUrl,
        summary: row.summary,
        tags: row.tags ?? [],
        persons,
        companies,
        entities: itemEntities,
        tierScore: row.tierScore,
        tier: displayTier({ tier: tier(row.tier), tierScore: row.tierScore }),
        preference: explicitPreference(row.preferenceSignal),
        readAt: row.readAt?.toISOString() ?? null,
        archiveRequestedAt: row.archiveRequestedAt?.toISOString() ?? null,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        obsidianPath: row.obsidianPath,
        status: row.status,
        rejectReason: row.rejectReason,
        isNewEntity,
        monthlyMention: strongestMention([...companies, ...persons], mentionCounts),
        coverTone: toneFor(row.id),
      };
    };

    return {
      items: rows.map((row) => toFeedItem(row)),
      history: historyRows.map((row) => toFeedItem(row)),
      obsidianVaultName: process.env.AFS_OBSIDIAN_VAULT_NAME?.trim() || null,
      generatedAt: new Date().toISOString(),
      mode: 'database',
    };
  } catch {
    return {
      ...createDemoFeed(),
      notice: '数据库读取失败，当前显示演示数据',
    };
  }
}

function explicitPreference(value: string | null): FeedPreference {
  return value === 'like' || value === 'dislike' ? value : null;
}

function entityRef(
  kind: 'person' | 'company',
  name: string,
  index: Map<string, { id: string; kind: string; canonicalName: string; firstSeenAt: Date; starred: boolean }>,
): FeedEntityRef {
  const entity = index.get(`${kind}:${name}`);
  return { id: entity?.id ?? null, kind, name, starred: entity?.starred ?? false };
}

interface MentionRow {
  persons: string[] | null;
  companies: string[] | null;
  sourceId: string;
  publishedAt: Date | null;
  firstSeenAt: Date;
}

/** 同一信源、同一人物、发布时间相差在此之内 → 视为同一场对话的切片 */
const SAME_CONVERSATION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 数「对话」而不是数「条目」。
 *
 * 实测：Lex Fridman 把一场 DHH 访谈切成 5 条视频分两天发布，角标就显示成
 * 「DHH 本月第 5 场」——但那是一场对话。切片的字幕内容各不相同，
 * simhash 去重挡不住，只能在计数这一层按「同源 + 同人 + 相近日期」聚类。
 *
 * 这个角标的意义是「这个人在密集发声」，一场被切五段不构成密集发声。
 */
export function countMentions(rows: MentionRow[]): Map<string, number> {
  const byName = new Map<string, Array<{ sourceId: string; at: number }>>();
  for (const row of rows) {
    const at = (row.publishedAt ?? row.firstSeenAt).getTime();
    for (const name of new Set([...(row.persons ?? []), ...(row.companies ?? [])])) {
      const list = byName.get(name) ?? [];
      list.push({ sourceId: row.sourceId, at });
      byName.set(name, list);
    }
  }

  const counts = new Map<string, number>();
  for (const [name, appearances] of byName) {
    appearances.sort((a, b) => a.at - b.at);
    let conversations = 0;
    const lastPerSource = new Map<string, number>();
    for (const { sourceId, at } of appearances) {
      const previous = lastPerSource.get(sourceId);
      // 换了信源，或与该信源上一次相隔超过窗口 → 算新的一场
      if (previous === undefined || at - previous > SAME_CONVERSATION_MS) conversations += 1;
      lastPerSource.set(sourceId, at);
    }
    counts.set(name, conversations);
  }
  return counts;
}

function strongestMention(names: string[], counts: Map<string, number>): MonthlyMention | null {
  const mention = names
    .map((name) => ({ name, count: counts.get(name) ?? 0 }))
    .filter(({ count }) => count > 2)
    .sort((a, b) => b.count - a.count)[0];
  return mention ?? null;
}

function mediaType(value: string): FeedMediaType {
  return value === 'video' || value === 'podcast' ? value : 'article';
}

function tier(value: string): FeedTier {
  return value === 'highlight' || value === 'folded' ? value : 'feed';
}

function toneFor(value: string): number {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 7;
}
