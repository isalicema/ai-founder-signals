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
├── types.ts       LlmProvider 接口
├── deepseek.ts    默认供应商（OpenAI 兼容口，deepseek-v4-flash）
├── anthropic.ts   备选供应商
├── provider.ts    供应商选择 + 校验重试 + 用量台账 + 分时计价
├── judge.ts       L2 准入判定 → 直接传给 admit() 的第二个参数
├── summarize.ts   摘要 + 标签 + 人物公司（含引文校验与重试）
└── guards.ts      引文守卫（prompt 是请求，代码才是保证）
src/worker/analyze.ts   adapter.fetch → 摘要 的接缝
```

⚠️ **DeepSeek 只有 `response_format:{type:'json_object'}`，没有 json_schema。**
服务端不保证结构，所以校验必须在我们这边做：`completeJsonValidated()` 统一负责
zod 校验 + 失败重试 + 记账。**不要绕过它直接调 provider.completeJson()**，
那样会静默退化成「以为有 schema 保证、其实没有」。
另外官方文档提示「可能偶尔返回空内容」，空返回按失败处理并重试，不当空对象。

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
DEEPSEEK_API_KEY=sk-... npx tsx tools/smokeLlm.ts
```
跑 4 条准入用例（含 2 条 RabbitT 的难反例）+ 1 次摘要，打印用量。约 $0.002。
**这是唯一能验证 LLM 层真的通的方式，单测全是桩。**

---

## M6 收藏队列接缝已就位（妙蛙种子）

`tools/archiveQueue.ts` —— feed 与 collection-manager 的接缝。

```bash
npx tsx tools/archiveQueue.ts list        # 列出待处理
npx tsx tools/archiveQueue.ts done <id>   # 回写 archived_at
```

星子这边只需要保证 M5 的「🔖 深看」按钮写 `item.archive_requested_at`
（已完成，见 `src/app/actions.ts`）。**不要在网页里调 collection-manager**
——那需要本地常驻服务，而 worker 设计成跑在 Actions 上。

工作流：Alice 点「深看」（零成本意向标记，不阻塞）→ 稍后在 Claude Code 说
「处理收藏队列」→ 妙蛙种子读队列逐条跑 collection-manager → 回写。

---

## Worker 主入口已就位（妙蛙种子）

```
src/worker/
├── handlers.ts   discover / process 两个任务处理器
├── persist.ts    entity 自动登记、去重 L2、已见 external_id
├── run.ts        认领循环 + 分派 + 当日排班
tools/worker.ts   CLI 入口
.github/workflows/worker.yml   每天北京 06:00
```

```bash
npx tsx tools/worker.ts                # 排当日 discover + 跑到排空
npx tsx tools/worker.ts --max-jobs 3   # 小步试跑
npx tsx tools/worker.ts --no-enqueue   # 只消费现有队列
```

### 链路

```
enqueueDailyDiscover  每个启用信源一个 discover 任务（key 带日期，当天重复调用不重复排）
  └─ discover  adapter.discover() → 过滤已见 external_id → 为每条排一个 process 任务
       └─ process  admit()（判定在抓正文之前）
            ├─ folded    → 入库，tier=folded，不抓正文、不调摘要
            ├─ needs_body → 入库，status=needs_body（抓不到正文是降级不是丢失）
            ├─ duplicate  → simhash 汉明距 ≤3，跳过
            └─ accepted   → withTempWorkspace → 摘要 → entity 登记 → 分档 → 入库
```

### 三条已写成测试的不变量

1. **folded 条目仍然入库，但绝不下载正文、不花摘要的钱**
2. **融资/榜单类标题在 L1 就判负，连 L2 都不调**
3. **异常只记安全分类码**——`classify()` 对未知异常一律返回 `unclassified_error`，
   不让异常消息（可能含正文片段）流进数据库

### ⚠️ rescore 任务故意没实现

`dispatch()` 里 rescore 直接抛错。实现前必须先解决**「反馈会被 rescore 洗掉」**：
`item` 表没有 `user_signal` 列，rescore 从 `tier_score` 重算 tier 会抹掉 Alice
手动点的 👍👎。要么加回该列并让 rescore 跳过，要么让 rescore 查 `feedback`
最新信号。**这是我压表时删掉那列留下的坑，别在没定规则前实现 rescore。**

---

## 部署：本地 launchd（不用 GitHub Actions）

```
scripts/run-worker.sh   每日 worker（launchd 06:00 调起）
scripts/run-web.sh      feed 网页常驻 localhost:3000
scripts/afs             控制台：status / run / build / web / logs / open / start / stop
~/Library/LaunchAgents/com.machiwhale.afs.{worker,web}.plist
~/Library/Logs/afs-{worker,web}.log
```

### 为什么不用 Actions

2026-08-29 实测：**YouTube 拦截数据中心 IP**，Actions runner 上 yt-dlp 直接报
`Sign in to confirm you're not a bot`，一条字幕都取不到。11 个可跑信源里 8 个是
YouTube，云端跑出来只剩标题卡——「Mac 没开也能跑」换来的是个降级 feed。

云端其余部分都是通的（数据库经 Session pooler、DeepSeek HTTP 200），
所以 `worker.yml` 保留手动触发，定时停用。诊断脚本在 `.github/workflows/diagnose.yml`。

⚠️ **不要为此给 yt-dlp 配 cookies 或代理**——那是绕过反爬，我们在 36氪、
知乎已经划过这条线，不该对 YouTube 破例。

### 三个踩过的坑，别再踩

1. **plist 里不要写死 nvm 的版本路径**（`.nvm/versions/node/v24.19.0/bin/node`）——
   升级 node 就断。包装脚本里 source nvm.sh 动态解析。
2. **构建不要放进被 KeepAlive 守护的进程**。构建一旦被重启打断就永远完不成，
   形成「构建→被杀→重启→再构建」的循环。实测踩过。改代码后用 `afs build`。
3. **判断有没有生产构建要看 `.next/BUILD_ID`，不是 `.next` 目录**——
   `next dev` 也会写 `.next` 但结构不同，`next start` 起不来，
   表现为「进程活着、端口不响应」，很难看出原因。
