# 给星子的交接说明

> 架构文档：`~/Smart Workspace/Machiwhale Studio/Project/AI Founder Signals｜工程可行性与技术路线 v2.1.md`
> 有疑问先读文档，文档没写的问我（妙蛙种子），别自己猜。

## 星子进度（2026-08-29）

- ✅ M1：Next.js 15 App Router、严格 TypeScript、ESLint、Vitest、GitHub Actions
- ✅ M2：五表 Drizzle schema、Supabase migration、RLS 默认封闭
- ✅ M3：`claimJob/completeJob/failJob`、`SKIP LOCKED`、指数退避、`withTempWorkspace(fn)`
- ✅ worker 红线测试：folded 入库但不抓正文/不跑摘要；临时区成功和异常路径均清理
- ✅ M4：`SourceAdapter` 注册表、RSS/Atom、服务端播客页回退、YouTube Atom + yt-dlp 字幕
- ✅ M4 真源冒烟：8 个 YouTube + 3 个播客 seed 均发现 15 条；字幕只在 M3 临时区出现并已验证清理
- ✅ M5：六维筛选、未读优先、highlight/feed/folded、🆕/🔥 badge、明确的「🤖 AI 摘要」分区
- ✅ M5 交互：看原文、深看、👎、👍、entity 星标均为一次点击；folded 保留并可恢复
- ✅ M5 浏览器验收：1440px 桌面与 390px 移动端通过，零横向溢出、零 console/page error
- 🔒 M7 前默认演示模式；DB 读取和持久化动作分别由环境开关显式启用，避免匿名暴露私有 Feed
- ⏳ migration 实库重放：当前机器没有 Docker/Podman/本地 Postgres，待有本地容器或远程 Supabase 项目时执行

## 你的模块（按顺序）

| # | 模块 | 要点 |
|---|---|---|
| M1 | 脚手架 | Next.js 15 App Router + Drizzle + Supabase client。**本仓已有 TS/vitest 基础配置，在其上加，别重建** |
| M2 | DB schema | 文档 §3 的 5 张表。注意 `item` 表要把「事实字段」和「AI 生成字段」分段并注释 |
| M3 | Job 队列 | Postgres `SKIP LOCKED`（文档 §3.5）。**必须实现 `withTempWorkspace(fn)`**，finally 无条件 rm -rf |
| M4 | 适配器 | 文档 §7.3 的 `SourceAdapter`。RSS + YouTube 两个实现 |
| M5 | **Feed 页面** ⭐ | 文档 §5。最高优先级，产品本体 |
| M6 | 收藏队列接缝 | 只需写 `archive_requested_at` + 一个查询 API，Claude Code 侧脚本我来写 |
| M7 | 认证 | Supabase Auth + middleware 白名单邮箱，无匿名页 |
| M8 | 信源设置页 | Source CRUD + 健康灯 + 失败任务重置 |

## 直接用我写好的，别重写

```ts
import { admit } from './pipeline/admission';
import { scoreTier, normalizeSourceWeight } from './pipeline/tier';
import { upsertEntity } from './pipeline/entity/normalize';

// 1) 列表阶段就判定 —— 注意在下载正文之前
const a = await admit(
  { title, snippet, mediaType, durationSeconds, contentChars, source: { purity: src.purity } },
  llmJudge,   // 用 prompts/admission-l2.md，可不传（保守放行）
);

// 2) ⚠️ 被拒的也要入库，只是不抓正文、不生成摘要
if (!a.shouldFetchBody) {
  await db.insert(item).values({ ...meta, tier: 'folded', tier_reason: {...}, /* reject_reason */ });
  return;
}

// 3) 抓正文 → 摘要 → entity 登记 → 分档
const t = scoreTier({
  sourceWeight: normalizeSourceWeight(src.weight),
  titleSignal: a.titleSignalScore,
  admissionConfidence: a.admissionConfidence,
  entityStarred,
});
```

## 五条红线

1. **被判 folded 的条目仍然入库。** 永不丢弃，只降权——判定必然误判，丢掉不可逆、折叠可逆。
2. **raw 不出 worker 进程。** tmp 目录 try/finally 强制清理；**LLM 调用日志不许记 raw 内容**，只记 hash 和 token 数。
3. **不下载正文给 folded 的条目。** 判定在抓取之前，这是省钱也是少给对方服务器压力。
4. **卡片上摘要区必须有「🤖 AI 摘要」标识**，与标题/媒体/日期这些事实字段视觉分开。用户无法翻原文核对，界面要自己承担诚实性。
5. **不允许在 pipeline 里写 `if (source.name === '晚点')`。** 新信源 = 新写一个 `SourceAdapter`。

## Feed 页面的验收标准是体感的

**Alice 早上打开，30 秒内扫完当天新增、知道有没有值得点开的。** 做不到这一点，其他模块做得再好都白搭。

两个 badge 记得做（都只陈述事实、不参与打分，判断留给 Alice）：
- 🆕 **首次出现** —— `upsertEntity` 返回的 `isNew`
- 🔥 **本月第 N 场** —— 按 `companies` / `persons` 分组统计近 30 天，>2 才显示

## 提交约定

**不要自己 push。** 本地 commit，需要上 GitHub 时告诉我，由我统一把关后提交。

---

## LLM 层已就位（妙蛙种子，2026-08-29）

```
src/llm/
├── provider.ts    模型解析（env 可覆盖）+ 用量台账 + 成本计价
├── judge.ts       L2 准入判定 → 直接传给 admit() 的第二个参数
├── summarize.ts   摘要 + 标签 + 人物公司（含引文校验与重试）
└── guards.ts      引文守卫（prompt 是请求，代码才是保证）
src/worker/analyze.ts   adapter.fetch → 摘要 的接缝
```

### 接进 worker 的方式

```ts
import { createLlmJudge, UsageLedger } from '../llm';
import { analyzeInWorkspace } from './analyze';

const ledger = new UsageLedger();

await processItem(admissionInput, {
  llmJudge: createLlmJudge(ledger),                    // ← L2
  insertFolded: async (folded, admission) => { /* 写库，不抓正文 */ },
  fetchAndAnalyze: (workspace, admission) =>
    analyzeInWorkspace(adapter, item, source.name, workspace, ledger),
  insertAccepted: async (analysis, admission) => { /* 写库 */ },
});

// 一轮跑完打印一行，用于成本对账
process.stdout.write(ledger.summary() + '\n');
```

⚠️ **`analyzeInWorkspace` 是 raw 唯一的合法停留处。** 它返回 `PersistableAnalysis`，
类型里没有 `rawText`——raw 在编译期就流不进持久化代码。必须包在 `withTempWorkspace` 里调。

### 三条不要碰的

1. **不要在 llm/ 里加 console 打印。** `tests/llmRedline.test.ts` 会 grep 源码断言。
   要观测就往 `UsageLedger` 里加字段，那里只有 token 数和 sha256 指纹。
2. **不要绕过 `sanitizeTags`。** LLM 返回集合外的 tag 必须丢弃并留痕。
3. **不要把 `checkSummary` 降级成警告。** 系统不存原文，编造的引文事后无法核验。

### 冒烟测试（我这边没有凭据，跑不了）

```bash
ANTHROPIC_API_KEY=sk-... npx tsx tools/smokeLlm.ts
```
跑 4 条准入用例（含 2 条 RabbitT 的难反例）+ 1 次摘要，打印用量。约 $0.01。
**这是唯一能验证 LLM 层真的通的方式，单测全是桩。**
