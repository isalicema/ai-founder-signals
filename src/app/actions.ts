'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { sharedDb } from '../db/shared';
import { entities, feedback, items } from '../db/schema';
import type { FeedActionResult, FeedItemAction } from '../feed/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persistent mutations are deliberately opt-in until M7 adds the whitelist
 * auth guard. The M5 preview still responds optimistically in the browser.
 */
export async function applyFeedAction(action: FeedItemAction): Promise<FeedActionResult> {
  if (process.env.AFS_FEED_MUTATIONS_ENABLED !== 'true') {
    return { ok: true, persisted: false };
  }
  if (!process.env.SUPABASE_DB_URL) return { ok: false, persisted: false };

  const connection = sharedDb();
  try {
    if (action.type === 'toggle_entity_star') {
      const condition = action.entityId && UUID.test(action.entityId)
        ? eq(entities.id, action.entityId)
        : and(eq(entities.kind, action.entityKind), eq(entities.canonicalName, action.entityName));
      await connection.db.update(entities).set({ starred: action.starred }).where(condition);
    } else if (action.type === 'set_items_read') {
      const itemIds = [...new Set(action.itemIds.filter((id) => UUID.test(id)))];
      if (itemIds.length === 0) return { ok: true, persisted: false };
      await connection.db.transaction(async (transaction) => {
        for (let offset = 0; offset < itemIds.length; offset += 120) {
          await transaction
            .update(items)
            .set({ readAt: action.readAt ? new Date(action.readAt) : null })
            .where(inArray(items.id, itemIds.slice(offset, offset + 120)));
        }
      });
    } else {
      if (!UUID.test(action.itemId)) return { ok: true, persisted: false };
      const at = new Date(action.at);
      await connection.db.transaction(async (transaction) => {
        if (action.type === 'opened_source') {
          // 只记录浏览行为；打开原文不代表已经完成这张卡片的判断。
          await transaction.insert(feedback).values({ itemId: action.itemId, signal: 'opened_source' });
        } else if (action.type === 'archive_requested') {
          await transaction.update(items).set({ archiveRequestedAt: at }).where(eq(items.id, action.itemId));
          await transaction.insert(feedback).values({ itemId: action.itemId, signal: 'archive_requested' });
        } else if (action.type === 'irrelevant') {
          await transaction.update(items).set({ tier: 'folded', readAt: at }).where(eq(items.id, action.itemId));
          await transaction.insert(feedback).values({ itemId: action.itemId, signal: 'irrelevant' });
        } else if (action.type === 'restore_highlight') {
          await transaction.update(items).set({ tier: 'highlight', readAt: null }).where(eq(items.id, action.itemId));
          await transaction.insert(feedback).values({ itemId: action.itemId, signal: 'great' });
        } else if (action.type === 'set_highlight') {
          await transaction.update(items).set(
            action.highlighted ? { tier: 'highlight', readAt: at } : { tier: 'feed' },
          ).where(eq(items.id, action.itemId));
          if (action.highlighted) {
            await transaction.insert(feedback).values({ itemId: action.itemId, signal: 'great' });
          }
        }
      });
    }
    revalidatePath('/');
    return { ok: true, persisted: true };
  } catch {
    return { ok: false, persisted: false };
  }
}
