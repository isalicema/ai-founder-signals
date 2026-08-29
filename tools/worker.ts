/**
 * Worker 主入口。GitHub Actions 每天调一次，也可以本地手动跑。
 *
 *   npx tsx tools/worker.ts            # 排当日 discover + 跑到队列排空
 *   npx tsx tools/worker.ts --no-enqueue   # 只消费现有队列，不新排任务
 *   npx tsx tools/worker.ts --max-jobs 5   # 小步试跑
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname); } catch { /* 可选 */ }

import { createDatabaseConnection } from '../src/db/client.js';
import { runWorker, enqueueDailyDiscover } from '../src/worker/run.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

for (const [name, hint] of [
  ['SUPABASE_DB_URL', '数据库连接串'],
  ['DEEPSEEK_API_KEY', 'DeepSeek key（或设 AFS_LLM_PROVIDER=anthropic）'],
] as const) {
  if (!process.env[name]?.trim() && !(name === 'DEEPSEEK_API_KEY' && process.env.AFS_LLM_PROVIDER === 'anthropic')) {
    console.error(`❌ 缺少 ${name}（${hint}）——请在 .env.local 里配置`);
    process.exit(1);
  }
}

const connection = createDatabaseConnection({ maxConnections: 2 });
try {
  if (!flag('--no-enqueue')) {
    const { queued, skipped } = await enqueueDailyDiscover(connection.db, connection.sql);
    console.log(`已排 ${queued} 个 discover 任务`);
    if (skipped.length > 0) console.log(`跳过 ${skipped.length} 个暂无适配器的信源：${skipped.join('、')}`);
  }
  const report = await runWorker(connection.db, connection.sql, {
    maxJobs: value('--max-jobs', 200),
    budgetMs: value('--budget-min', 20) * 60 * 1000,
  });
  console.log(`\n认领 ${report.claimed} · 完成 ${report.completed} · 失败 ${report.failed} · 停因 ${report.stoppedBy}`);
  for (const [k, v] of Object.entries(report.outcomes).sort()) console.log(`  ${k}: ${v}`);
  console.log(`\n${report.usage}`);
  if (report.failed > 0) process.exitCode = 1;
} catch (error) {
  // ⚠️ 实测：GitHub Actions runner 只有 IPv4，而 Supabase 新项目的直连主机
  //    db.<ref>.supabase.co 只解析出 IPv6 → ENETUNREACH。本地能跑、云端跑不了。
  //    把补救办法直接写在日志里，别让下次的人对着堆栈猜。
  const message = (error as Error)?.message ?? String(error);
  const cause = (error as { cause?: { code?: string; address?: string } })?.cause;
  const code = cause?.code ?? '';
  console.error(`\n❌ worker 失败：${message.split('\n')[0]}`);
  if (code === 'ENETUNREACH' || /ENETUNREACH/.test(message)) {
    console.error(
      '\n   → 连不上数据库，目标是 IPv6 地址而当前环境只有 IPv4。\n' +
      '     GitHub Actions runner 就是这种情况。\n' +
      '     改用 Session pooler 连接串（IPv4 友好）：\n' +
      '     Supabase 控制台 → 页面顶部 Connect → Session pooler → 整行复制\n' +
      '     形如 postgresql://postgres.<ref>:<密码>@aws-N-<region>.pooler.supabase.com:5432/postgres',
    );
  } else if (/password authentication|SASL|28P01/i.test(message)) {
    console.error('   → 密码不对。含特殊字符时需要百分号编码（@→%40 #→%23 /→%2F）');
  }
  process.exitCode = 1;
} finally {
  await connection.close();
}
