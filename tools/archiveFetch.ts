/**
 * 取出队列里某条内容的完整正文，打印到 stdout。
 *
 *   npx tsx tools/archiveFetch.ts <item-id>
 *
 * 为什么要有这个：收藏队列只给 URL，下游 agent 还得自己想办法抓正文。
 * 但本仓库对自己支持的每类信源本来就有抓取能力（YouTube 字幕、播客 show notes、
 * 网页正文），复用即可——不必再去装一套提取器。
 *
 * ⚠️ 输出里带 provenance 标注。show notes 是节目方写的说明**不是对话实录**，
 *    据此写摘要时不能写成受访者的第一人称。
 */
process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname);

import { eq } from 'drizzle-orm';
import { createDatabaseConnection } from '../src/db/client.js';
import { items, sources } from '../src/db/schema.js';
import { createDefaultAdapterRegistry } from '../src/adapters/registry.js';
import { withTempWorkspace } from '../src/worker/tempWorkspace.js';

const id = process.argv[2];
if (!id) {
  console.error('用法：npx tsx tools/archiveFetch.ts <item-id>（id 从 archiveQueue list 拿）');
  process.exit(1);
}

const connection = createDatabaseConnection({ maxConnections: 1 });
try {
  const [row] = await connection.db
    .select({ item: items, source: sources })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.id, id));

  if (!row) {
    console.error(`找不到条目 ${id}`);
    process.exit(1);
  }

  const { item, source } = row;
  console.log(`# ${item.title}\n`);
  console.log(`- 来源：${source.name}`);
  console.log(`- 链接：${item.url}`);
  if (item.publishedAt) console.log(`- 发布：${item.publishedAt.toISOString().slice(0, 10)}`);
  if (item.persons?.length) console.log(`- 人物：${item.persons.join('、')}`);
  if (item.companies?.length) console.log(`- 公司：${item.companies.join('、')}`);
  if (item.tags?.length) console.log(`- 标签：${item.tags.join('、')}`);
  if (item.summary) console.log(`\n## 管线生成的摘要（仅供参考，请以正文为准）\n\n${item.summary}`);

  try {
    const adapter = createDefaultAdapterRegistry().forSource(source);
    const content = await withTempWorkspace((workspace) => adapter.fetch({
      externalId: item.externalId ?? item.id,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      mediaType: item.mediaType as 'article' | 'video' | 'podcast',
      durationSeconds: item.durationSeconds ?? undefined,
    }, { workspace }));

    const label = {
      transcript: '视频字幕转写（可能有断句错误，按语义理解）',
      shownotes: '⚠️ 节目方撰写的 show notes / 大纲，**不是对话实录**——'
        + '能说明「这期会谈什么」，说不了「实际谈出了什么」。'
        + '不要写成受访者的第一人称表达',
      body: '网页正文',
    }[content.provenance ?? 'body'];

    console.log(`\n## 正文（${content.rawText.length} 字 · ${label}）\n`);
    console.log(content.rawText);
  } catch (error) {
    console.log(`\n## 正文\n\n（取不到：${(error as Error).message}）`);
    console.log(`请直接打开 ${item.url}`);
  }
} finally {
  await connection.close();
}
