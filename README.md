# AI Founder Signals

AI 创始人一手访谈探测器 —— `collection-manager` 的前置漏斗。

自动扫描信源 → 判定是否创始人一手访谈 → 生成 feed 卡片 → Alice 挑出想深看的 → 交给
现有的 `collection-manager` skill 做深度分析并存进 Obsidian 收藏夹。

> 架构文档：`~/Smart Workspace/Machiwhale Studio/Project/AI Founder Signals｜工程可行性与技术路线 v2.1.md`

## 当前状态

| 部分 | 负责人 | 状态 |
|---|---|---|
| 准入判定规则 + 分档 + entity 归一化 | 妙蛙种子 | ✅ 已完成，27 测试全绿 |
| 判定 / 摘要 prompt | 妙蛙种子 | ✅ 初版完成 |
| M1（Next.js / TS / CI） | 星子 | ✅ 已完成 |
| M2（Drizzle schema / Supabase migration / RLS） | 星子 | ✅ 代码完成；待有容器或远程项目时重放迁移 |
| M3（Job 队列 / worker 骨架 / 临时区） | 星子 | ✅ 已完成，36 测试全绿 |
| M4-M5（适配器 / Feed 页） | 星子 | ⏳ 待信源清单后继续 |
| 15 个信源清单 | Alice | 🟡 整理中 |
| 15 个一级主题 + 5 正例 5 反例 | RabbitT | ⏳ |

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
supabase/               可重放 migration + 默认封闭的 RLS 测试
```

## 开发

```bash
npm install
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm test          # Vitest，当前 36 项
npm run build     # Next.js production build
```

数据库迁移以 `supabase/migrations/` 为事实来源，Drizzle schema 用于应用侧类型与查询。
本地具备容器运行时后执行 `npm run db:reset`，再执行 `npm run db:test` 验证 schema 与 RLS。
