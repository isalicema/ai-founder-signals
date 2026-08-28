/**
 * 真实 API 冒烟测试。单测全是桩，这个才验证 LLM 层真的能跑通。
 *
 *   DEEPSEEK_API_KEY=sk-... npx tsx tools/smokeLlm.ts
 *   AFS_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npx tsx tools/smokeLlm.ts
 *
 * 预计花费：DeepSeek 约 $0.002。
 */
// 自动加载 .env.local（Node 20.6+ 内置，不需要 dotenv）
try { process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname); } catch { /* 没有就算了 */ }

import { createLlmJudge } from '../src/llm/judge.js';
import { summarizeItem } from '../src/llm/summarize.js';
import { UsageLedger, llmProvider, isPeakWindow } from '../src/llm/provider.js';

const CASES = [
  { title: '对话与爱为舞张怀亭：大哥创业不走弯路', snippet: '张怀亭复盘了与爱为舞的产品取舍与团队搭建。', expect: true },
  { title: 'Sam Altman 最新访谈的十个关键要点：AGI、算力与下一代模型', snippet: '本文整理了访谈中的十个要点。', expect: false },
  { title: '对话 Gartner 分析师：企业 Agent 将如何重构 SaaS 市场', snippet: '分析师谈企业 Agent 的采纳节奏。', expect: false },
  { title: 'Supabase: Cash Does Not Equal Success', snippet: 'The founders discuss what they learned about burn and focus.', expect: true },
];

if (!process.env.DEEPSEEK_API_KEY?.trim() && (process.env.AFS_LLM_PROVIDER ?? 'deepseek') === 'deepseek') {
  console.error('\n❌ 没找到 DEEPSEEK_API_KEY。\n');
  console.error('   请编辑 .env.local，在 DEEPSEEK_API_KEY= 后面贴上 key，然后重跑：');
  console.error('   npx tsx tools/smokeLlm.ts\n');
  process.exit(1);
}

const ledger = new UsageLedger();
const p = llmProvider();
console.log(`供应商：${p.name}  admission=${p.modelFor('admission')}  summary=${p.modelFor('summary')}`);
console.log(`计价档：${isPeakWindow() ? '高峰' : '平峰'}\n`);

let pass = 0;
const judge = createLlmJudge(ledger);
for (const c of CASES) {
  const r = await judge({ title: c.title, snippet: c.snippet });
  const ok = r.is_founder_interview === c.expect;
  if (ok) pass += 1;
  console.log(`${ok ? '✅' : '❌'} ${String(r.is_founder_interview).padEnd(5)} conf=${r.confidence.toFixed(2)}  ${c.title.slice(0, 40)}`);
  if (r.reject_reason) console.log(`     理由: ${r.reject_reason}`);
}
console.log(`\n准入判定 ${pass}/${CASES.length}\n`);

const analysis = await summarizeItem({
  title: '对话某某某：我们为什么把 Agent 产品收窄到一个入口',
  sourceName: '晚点 LatePost',
  body: `（测试正文）创始人谈到，团队最初做了七个功能入口，三个月后砍到一个。
理由是用户在多入口下完成率只有 12%，收窄后升到 41%。他还提到组织上的代价：
砍掉的功能对应两个小组，最终合并成一个，有两位负责人离开。
关于商业模式，他说基础能力免费、稳定托管和企业适配收费，目前付费转化 3.8%。
他也承认对明年市场规模的判断"没有数据支撑，纯粹是直觉"。`.repeat(3),
}, ledger);

console.log('摘要：', analysis.summary);
console.log('标签：', analysis.tags.join(' / '));
console.log('人物：', analysis.persons.join(', '), '| 公司：', analysis.companies.join(', '));
console.log('告警：', analysis.warnings.length ? analysis.warnings.join(', ') : '无');
console.log('\n' + ledger.summary());
