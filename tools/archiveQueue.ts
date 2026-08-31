/**
 * 收藏队列 —— feed 与 下游深读流程 的接缝（架构文档 §6）。
 *
 * 用户在 feed 里点「🔖 深看」只写一个 archive_requested_at，零成本、不阻塞。
 * 真正的深度分析在她有空、有上下文的时候批量跑：
 *
 *   用户说「处理收藏队列」
 *     → npx tsx tools/archiveQueue.ts list        # 我读出待办
 *     → 逐条跑 下游深读流程（抓原文→深度分析→存 Obsidian）
 *     → npx tsx tools/archiveQueue.ts done <id>   # 回写 archived_at
 *
 * 选这个方案而不是让网页直接调本地服务：零耦合、无常驻进程、失败可重试，
 * 且天然复用已经跑通两年的 下游深读流程。
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname); } catch { /* 可选 */ }

import { and, eq, isNotNull, isNull, asc } from 'drizzle-orm';
import { createDatabaseConnection } from '../src/db/client.js';
import { items, sources } from '../src/db/schema.js';

const [command, argument] = process.argv.slice(2);

if (!process.env.SUPABASE_DB_URL?.trim()) {
  console.error('❌ 缺少 SUPABASE_DB_URL，请在 .env.local 里配置');
  process.exit(1);
}

const connection = createDatabaseConnection({ maxConnections: 1 });

try {
  if (command === 'list') {
    const rows = await connection.db
      .select({
        id: items.id,
        title: items.title,
        url: items.url,
        sourceName: sources.name,
        persons: items.persons,
        companies: items.companies,
        requestedAt: items.archiveRequestedAt,
      })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .where(and(isNotNull(items.archiveRequestedAt), isNull(items.archivedAt)))
      .orderBy(asc(items.archiveRequestedAt));

    if (rows.length === 0) {
      console.log('收藏队列是空的。');
    } else {
      console.log(`待处理 ${rows.length} 条：\n`);
      for (const row of rows) {
        const who = [...(row.persons ?? []), ...(row.companies ?? [])].join(' · ');
        console.log(`[${row.id}]`);
        console.log(`  ${row.title}`);
        console.log(`  ${who || '（未识别人物/公司）'} / ${row.sourceName}`);
        console.log(`  ${row.url}`);
        console.log(`  标记于 ${row.requestedAt?.toISOString().slice(0, 16).replace('T', ' ')}\n`);
      }
      console.log('处理完一条后：npx tsx tools/archiveQueue.ts done <id>');
    }
  } else if (command === 'done') {
    if (!argument) {
      console.error('用法：npx tsx tools/archiveQueue.ts done <item-id>');
      process.exit(1);
    }
    // ⚠️ 只更新「还没归档」的，否则重复跑会静默重新盖时间戳，
    //    让人以为又处理了一遍。批量处理时最容易误判。
    const updated = await connection.db
      .update(items)
      .set({ archivedAt: new Date() })
      .where(and(eq(items.id, argument), isNotNull(items.archiveRequestedAt), isNull(items.archivedAt)))
      .returning({ id: items.id, title: items.title });

    if (updated.length === 0) {
      const [existing] = await connection.db
        .select({ title: items.title, archivedAt: items.archivedAt })
        .from(items).where(eq(items.id, argument));
      if (existing?.archivedAt) {
        console.log(`↩︎ 早就归档过了（${existing.archivedAt.toISOString().slice(0, 16).replace('T', ' ')}）：${existing.title}`);
      } else {
        console.error(`❌ 没找到待归档的条目 ${argument}（可能 id 错了，或它本来就没被标记）`);
        process.exitCode = 1;
      }
    } else {
      console.log(`✅ 已归档：${updated[0]!.title}`);
    }
  } else {
    console.log(`收藏队列

  list          列出待处理的条目
  done <id>     标记某条已存进你的笔记库

用户在 feed 点「🔖 深看」后，用 list 取出待办，逐条跑 下游深读流程，再用 done 回写。`);
  }
} finally {
  await connection.close();
}
