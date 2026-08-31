# 部署指南

> **这份是写给 agent 执行的。** 如果你是被丢进这个仓库的 AI 助手：
> 按顺序做完下面 5 步，每步都有验证命令。**任何时候不确定还缺什么，跑 `./scripts/afs doctor`**
> ——它会逐项检查并给出具体的下一步命令。

这是什么：一个只有你一个用户的私人 feed，每天自动抓 AI 创始人一手访谈，
判定 → 摘要 → 分档，打开浏览器三十秒扫完。详见 [PROJECT.md](PROJECT.md)。

**运行环境**：macOS（用 launchd 做定时）。Linux 需要把 `deploy/` 里的 plist 换成 systemd。

---

## 需要你自己准备的两样东西

| | 为什么跑不掉 | 成本 |
|---|---|---|
| **一个 Supabase 项目** | 数据库里是你自己的阅读记录 | 免费档够用 |
| **一个 DeepSeek API Key** | 判定和摘要的账单是你自己的 | 约 **$1/月** |

其余（信源清单、判定规则、主题体系、适配器）仓库里都有，不用重做。

---

## Step 1 · 装依赖

```bash
npm ci
```

还需要 `yt-dlp`（YouTube 源取字幕用）：

```bash
brew install yt-dlp
```

没有 yt-dlp 不会崩，但 8 个 YouTube 源只会产出「仅标题」卡片。

**验证**：`node -v` 是 v20+。

---

## Step 2 · 建数据库

1. 去 [supabase.com](https://supabase.com/dashboard) 建一个新项目（免费档）
2. 依次执行 `supabase/migrations/` 下的三个 `.sql`（SQL Editor 里粘贴运行即可）：
   ```
   20260828220344_initial_schema.sql        建 5 张表
   20260828220403_enable_rls_deny_all.sql   全表 RLS 拒绝一切
   20260829074210_add_json_api_source_config.sql
   ```

> **第二个迁移不要跳过。** Supabase 默认把 public 表通过 PostgREST 暴露给 anon key，
> 而 anon key 是公开的——不开 RLS 等于把整个私人 feed 挂在公网上。
> 开 RLS 不建 policy = PostgREST 一行都读不到；本项目走直连不受影响。

**验证**：Supabase 控制台 Table Editor 里能看到 `source` / `item` / `entity` / `feedback` / `job`。

---

## Step 3 · 填配置

```bash
cp .env.example .env.local
```

按文件里的注释填 `SUPABASE_DB_URL` 和 `DEEPSEEK_API_KEY` 两项，其余有默认值。

> **连接串一定要用 Session pooler，不要用 Direct connection**：
> 控制台**页面顶部的 "Connect" 按钮** → Session pooler → 整行复制 → 替换 `[YOUR-PASSWORD]`。
> 新项目的直连主机只解析 IPv6，很多网络环境连不上。

**验证**：

```bash
npx tsx tools/dbCheck.ts
```

连不上时它会按错误类型告诉你下一步（密码错 / 解析失败 / 该换 pooler 串）。

---

## Step 4 · 灌信源

```bash
npx tsx tools/seed.ts
```

写入 17 个信源（8 个 YouTube、3 个播客、3 个 JSON API、3 个 HTML）。
**这些的 `purity`（一手访谈占比）和「能否抓正文」都是实测校准过的**，不是猜的。

改信源直接编辑 `src/db/seed/sources.ts` 再跑一次——脚本是幂等的，按 url 冲突则更新。

**验证**：`npx tsx tools/dbCheck.ts` 显示「信源 17 个」。

---

## Step 5 · 装服务

```bash
./scripts/afs install
```

生成两个 launchd 服务（路径按你的实际克隆位置自动填）：

- **worker** — 每天 06:00 抓一次。睡眠中错过会在唤醒后补跑
- **web** — 常驻 `localhost:8166`

**验证**：

```bash
./scripts/afs doctor    # 应该全绿
./scripts/afs run       # 立刻抓一次，别等明早
./scripts/afs open      # 打开 feed
```

---

## Step 6 · 接上「深看」之后那一半（可选，但建议）

Feed 只负责发现。点「◇ 深看」会把条目放进队列，**但消费队列的那一半要你自己接**
——归档到哪儿取决于你用什么记笔记。

```bash
afs queue list          # 待处理
afs fetch <item-id>     # 取完整正文（YouTube 字幕 / 播客 show notes / 网页正文自动选路）
afs queue done <id>     # 归档完回写
```

**把 [docs/ARCHIVE-QUEUE.md](docs/ARCHIVE-QUEUE.md) 交给你的 agent** ——
那份写明了执行步骤、笔记的质量标准，以及一条不能忽略的 provenance 规则
（播客只有节目方写的大纲时，不能写成受访者的第一人称）。

不接也能用：feed 本身完整可用，「深看」就当收藏夹标记。

---

## 日常操作

```bash
./scripts/afs doctor   # 出问题先跑这个
./scripts/afs status   # 服务与数据概况
./scripts/afs run      # 立刻抓一次
./scripts/afs open     # 打开 feed（会确保服务起来）
./scripts/afs logs     # 跟踪 worker 日志
./scripts/afs build    # 改完代码后重建网页
./scripts/afs queue    # 收藏队列 list / done
./scripts/afs fetch    # 取某条完整正文
```

建议软链到 `PATH`，之后直接 `afs open`：

```bash
ln -sf "$PWD/scripts/afs" ~/bin/afs     # 确保 ~/bin 在 PATH 里
```

也可以把 `open-feed.command` 拖进 Dock，或做成快捷指令（用 `nohup … &` 包住，
否则快捷指令会干等服务启动）。

---

## 改成你自己的

| 想改什么 | 改哪儿 |
|---|---|
| 信源 | `src/db/seed/sources.ts` → `npx tsx tools/seed.ts` |
| 「是不是一手访谈」的判定 | `prompts/admission-l2.md` + `src/pipeline/admission/keywords.ts` |
| 摘要风格 | `prompts/summarize.md` |
| 主题标签（闭集，15 个） | `src/pipeline/topics.ts` |
| 排序权重 / 每天高亮几场 | `src/pipeline/tier/index.ts` |
| 抓取时间 | `deploy/*.plist.template` 里的 `StartCalendarInterval`，改完重跑 `afs install` |

⚠️ **改之前先读 [PROJECT.md](PROJECT.md) 的 §4「关键决策」**。那里每一条背后都有一次
真实的翻车，有些看起来「可以顺手优化」的地方其实是刻意为之——
比如不做人物白名单、准入不判断「是不是 AI 公司」、反爬对抗一律不做。

---

## 卸载

```bash
./scripts/afs uninstall    # 停服务、删 plist；日志和数据库不动
```

数据库要删就去 Supabase 控制台删项目。
