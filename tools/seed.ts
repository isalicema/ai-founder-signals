/**
 * 信源 seed。可重复执行——按 url 冲突则更新，不会产生重复行。
 *
 *   npx tsx tools/seed.ts          # 直连数据库写入（需要 SUPABASE_DB_URL）
 *   npx tsx tools/seed.ts --sql    # 只打印 SQL，供没有直连串时手动执行
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname); } catch { /* 可选 */ }

import { SEED_SOURCES } from '../src/db/seed/sources.js';

const quote = (v: unknown) =>
  v === null || v === undefined ? 'null'
  : typeof v === 'boolean' || typeof v === 'number' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;

const statements = SEED_SOURCES.map((s) => `insert into public.source
  (name, url, country, language, ingest_method, fetch_mode, purity, enabled)
values (${[s.name, s.url, s.country, s.language, s.ingestMethod, s.fetchMode, s.purity, s.enabled ?? true].map(quote).join(', ')})
on conflict (url) do update set
  name = excluded.name, country = excluded.country, language = excluded.language,
  ingest_method = excluded.ingest_method, fetch_mode = excluded.fetch_mode,
  purity = excluded.purity, enabled = excluded.enabled;`);

if (process.argv.includes('--sql')) {
  console.log(statements.join('\n'));
  process.exit(0);
}

if (!process.env.SUPABASE_DB_URL?.trim()) {
  console.error('❌ 缺少 SUPABASE_DB_URL。用 --sql 打印语句手动执行，或在 .env.local 里配置。');
  process.exit(1);
}

const { createDatabaseConnection } = await import('../src/db/client.js');
const connection = createDatabaseConnection({ maxConnections: 1 });
try {
  for (const statement of statements) await connection.sql.unsafe(statement);
  const [{ count }] = await connection.sql<Array<{ count: string }>>`select count(*) from public.source`;
  const [{ on }] = await connection.sql<Array<{ on: string }>>`select count(*) as on from public.source where enabled`;
  console.log(`✅ seed 完成：${count} 个信源，其中 ${on} 个启用`);
} finally {
  await connection.close();
}
