# AI Founder Signals

AI 创始人一手访谈探测器 —— `collection-manager` 的前置漏斗。

自动扫描信源 → 判定是否创始人一手访谈 → 生成 feed 卡片 → 你挑出想深看的 → 进收藏队列，
交给下游做深度分析并归档（我们这边接的是 Obsidian 收藏夹，你可以接自己的）。


> **要跑起来？** 看 [SETUP.md](SETUP.md)（5 步，约 15 分钟）。
> 不确定缺什么就跑 `./scripts/afs doctor`。
> **要改它？** 先读 [PROJECT.md](PROJECT.md) §4「关键决策」——那里每条背后都有一次真实的翻车。

## 现状

每天 06:00 自动跑，`localhost:8166` 随时可看。17 个信源全部可跑，
178 测试全绿，成本约 $1/月（DeepSeek）+ Supabase 免费档。

详细进度、决策与已知问题都在 [PROJECT.md](PROJECT.md)——**那份是权威来源**。

## 已实现

```
src/pipeline/
├── admission/          §4.0 三层准入漏斗
│   ├── keywords.ts     标题形态词表（强/弱正向、软/硬负向）
│   ├── titleSignal.ts  L1 规则判定 + 优先级
│   ├── structural.ts   时长/字数结构性信号（只降权，不排除）
│   └── index.ts        三层漏斗编排，L2 LLM 判官可注入
├── tier/               分档打分，四项加权 + 可解释 tier_reason
└── entity/             人物/公司归一化与自动登记
prompts/                L2 判定 + 摘要 prompt
src/db/                 Drizzle 五表 schema + 服务端连接
src/worker/             SKIP LOCKED 队列 + worker 红线编排 + 临时区生命周期
src/adapters/           RSS/Atom、播客、YouTube、配置化 JSON API、通用 HTML 发现
src/feed/               Feed 视图模型、DB 查询、演示数据、筛选与交互状态
supabase/               可重放 migration + 默认封闭的 RLS 测试
```

## 开发

```bash
npm install
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm test          # Vitest，当前 166 项
npm run build     # Next.js production build
```

M7 白名单认证落地前，Feed 默认使用演示数据且交互只做浏览器内乐观更新，避免误把私有内容暴露为匿名页。
受保护环境可设置 `AFS_FEED_DATA_MODE=database` 读取数据库；持久化动作另需显式设置
`AFS_FEED_MUTATIONS_ENABLED=true`。

数据库迁移以 `supabase/migrations/` 为事实来源，Drizzle schema 用于应用侧类型与查询。
本地具备容器运行时后执行 `npm run db:reset`，再执行 `npm run db:test` 验证 schema 与 RLS。
