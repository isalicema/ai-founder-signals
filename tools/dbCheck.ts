/**
 * 数据库连通性自检。跑 worker 之前先确认连得上，省得在半路上排查。
 *
 *   npx tsx tools/dbCheck.ts
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname); } catch { /* 可选 */ }

const raw = process.env.SUPABASE_DB_URL?.trim();
if (!raw) {
  console.error('❌ .env.local 里没有 SUPABASE_DB_URL');
  process.exit(1);
}
if (raw.includes('<密码>')) {
  console.error('❌ SUPABASE_DB_URL 里的 <密码> 还没替换成真实密码');
  process.exit(1);
}

const { assertConnectionString, createDatabaseConnection } = await import('../src/db/client.js');
try {
  assertConnectionString(raw);
} catch (error) {
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}

// 打印时抹掉密码
const shown = new URL(raw);
shown.password = '***';
console.log(`连接 ${shown.toString()}`);

const connection = createDatabaseConnection({ maxConnections: 1 });
try {
  const [{ version }] = await connection.sql<Array<{ version: string }>>`select version()`;
  console.log(`✅ 连接成功 · ${version.split(',')[0]}`);

  const tables = await connection.sql<Array<{ table_name: string; n: string }>>`
    select c.relname as table_name, c.reltuples::bigint::text as n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;
  console.log(`\n表 ${tables.length} 张：${tables.map((t) => t.table_name).join(', ')}`);

  const [{ total, on }] = await connection.sql<Array<{ total: string; on: string }>>`
    select count(*) as total, count(*) filter (where enabled) as on from public.source`;
  console.log(`信源 ${total} 个，启用 ${on} 个`);

  const [{ queued }] = await connection.sql<Array<{ queued: string }>>`
    select count(*) as queued from public.job where status = 'queued'`;
  const [{ items }] = await connection.sql<Array<{ items: string }>>`select count(*) as items from public.item`;
  console.log(`待跑任务 ${queued} 个 · 已收录 ${items} 条\n`);
  console.log('一切就绪，可以跑：npx tsx tools/worker.ts --max-jobs 3');
} catch (error) {
  const message = (error as Error).message;
  console.error(`\n❌ 连接失败：${message}`);
  if (/password authentication|SASL|28P01/i.test(message)) {
    console.error('   → 密码不对。若含特殊字符记得百分号编码（@→%40 #→%23 /→%2F）');
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    console.error('   → 域名解析失败，检查网络/代理');
  } else if (/ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(message)) {
    console.error('   → 连不上主机。改用控制台顶部 "Connect" 按钮里的 Session pooler 串（IPv4 友好）');
  }
  process.exitCode = 1;
} finally {
  await connection.close();
}
