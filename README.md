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
| M1-M5（Next.js / DB / 队列 / 适配器 / Feed 页） | 星子 | ⏳ 待开工，见 `docs/HANDOFF.md` |
| 15 个信源清单 | Alice | ⏳ **唯一的开工阻塞项** |
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
```

## 开发

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```
