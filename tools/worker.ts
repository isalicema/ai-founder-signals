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
} finally {
  await connection.close();
}
