# HtmlAdapter 施工说明（M4.5）

> 承接人：星子｜排在 M5 之后
> 目标：让 `ingestMethod: 'html'` 的信源可用。当前只解锁**晚点 LatePost** 和 **AI 闹**两个——
> 它们的列表在原始 HTML 里，实测可抓。

## 0. 为什么只有两个

seed 里 6 个 html 信源，另外 4 个（Founder Park 智源镜像 / 硅星人 36氪镜像 / 暗涌 / Z Potentials）
实测**列表页 JS 渲染，curl 连文章链接都拿不到**——问题不是「抓不到正文」而是「发现不了新内容」，
有了 HtmlAdapter 也没用。它们已 `enabled: false`，等浏览器抓取（Phase 2）或走 M8 手动投喂。

**不要为这 4 个写任何东西。**

## 1. 范围

```ts
export class HtmlAdapter implements SourceAdapter {
  readonly kinds = ['html'] as const;
  discover(source: AdapterSource): Promise<DiscoveredItem[]>;   // ← 本 spec 的全部工作量
  fetch(item, context): Promise<EphemeralContent>;              // ← 基本是现成件拼装
}
```

`fetch` 很简单，按现有模式走即可：

1. `source.fetchMode === 'discover_only'` → 直接 `throw new FetchBlockedError('article_body_missing')`
2. `fetchTextResource(item.url)` 取详情页
3. `extractArticleText(html)`（`src/adapters/html.ts` 已有，直接用）
4. 正文 < 200 字 → `throw new FetchBlockedError('article_body_missing')`
5. 返回 `{ rawText, language }`

**难点全在 `discover`。**

---

## 2. discover：怎么在不认识网站的前提下找到文章链接

### 2.1 红线：不许有 host 分支

跟 `parsePodcastPage` 一样的要求——**不允许出现 `if (host === 'latepost.com')`**。

如果启发式在某个站上失效，逃生舱是**加数据不是加代码**：给 `source` 表加一个
`config jsonb` 列存路径提示（例如 `{"linkPattern": "/news/dj_detail"}`）。
配置是数据，`if (name === '晚点')` 是代码——这条界线要守住。

⚠️ **但先别加这个列。** 下面的启发式在两个真实站上都验证过了，先跑起来看，
真失效再加。不要提前建设。

### 2.2 算法（已在真实 fixture 上验证）

```
1. 抽出页面里所有 <a href>，同源、非锚点、非 mailto/javascript
2. 把每个 URL 归一成「形态」：
     · path 按 / 切段，把「像 id 的段」替换为 {id}
       —— 纯数字，或长度≥6 且含数字
     · query 只保留参数名并排序（丢掉值）
     例：/news/dj_detail?id=3366  →  /news/dj_detail?id
         /zh/ainow/10048         →  /zh/ainow/{id}
3. 按形态分组，对每组计算 titleish 数：
     锚文本长度 ≥ 8、且不是纯数字、且不在停用词表里
     停用词：下一页 上一页 更多 首页 关于 登录 注册 More Next Prev …
4. 取 titleish 最高的那一组作为文章链接组
5. 若最高组 titleish < 3 → 返回空数组（宁可什么都不发现，也不要发现一堆导航链接）
```

### 2.3 ⚠️ 为什么不能用「最常见的 URL 形态」

这是最容易想到的解法，**但实测在 AI 闹上会输给分页链接**：

| 站点 | 形态 | 出现次数 | 是文章吗 |
|---|---|---|---|
| AI 闹 | `/zh/ainow?ap={n}` | 4 | ❌ 分页 |
| AI 闹 | `/zh/ainow/{id}` | 2 | ✅ 文章 |
| 晚点 | `/news/dj_detail?id` | 12 | ✅ 文章 |
| 晚点 | `/websites/index?id` | 9 | ❌ 网站目录 |

按出现次数排，AI 闹会选中分页；晚点也只领先 3 条，很脆。
**锚文本才是可靠信号**：分页链接的锚文本是数字，导航是短词，文章是标题。

按 §2.2 算法实测结果（区分度很干净）：

```
latepost-list   /news/dj_detail?id   titleish=11   次优组 titleish=2
ainow-list      /zh/ainow/{id}       titleish=4    次优组 titleish=1
```

### 2.4 DiscoveredItem 字段怎么填

| 字段 | 来源 |
|---|---|
| `externalId` | 从 URL 里抽出的 id 段（`3366` / `10048`）。抽不出就用 `url_canonical` 的 sha256 前 16 位 |
| `url` | 绝对化后的 href |
| `title` | 锚文本，`normalizeText` 后 trim |
| `publishedAt` | **列表页通常没有 → 填 `null`**。不要瞎猜，`first_seen_at` 会兜底排序 |
| `mediaType` | 固定 `'article'` |
| `coverUrl` | 锚内 `<img src>` 有就取，没有就 undefined |
| `admissionSnippet` | 锚附近的摘要文本（有就取，用 `admissionSnippet()` 截 500 字）；没有就 undefined |
| `durationSeconds` | undefined（文章没有时长，`contentChars` 在 fetch 后才知道） |

⚠️ `title` 是准入判定 L1 的**唯一输入**，锚文本取错了整条链路就废了。
取到导航文字（"更多"）而不是标题，比抓不到还糟——所以 §2.2 第 5 步宁可返回空。

---

## 3. 验收标准

fixture 已备好（真实页面，剥掉 script/style/svg/注释）：

```
tests/fixtures/html/latepost-list.html   17KB
tests/fixtures/html/ainow-list.html      25KB
```

必须通过：

```
1. latepost-list.html → 发现 ≥10 条，全部形如 /news/dj_detail?id=<数字>
2. ainow-list.html    → 发现 ≥4 条，全部在 /zh/ainow/ 下
3. 两个 fixture 的结果里，title 全部非空且长度 ≥ 8
4. 结果里不含分页链接（?ap=）、不含网站目录（/websites/）、不含 /zh/about /zh/legal
5. ⭐ 同一份 fixture 跑两次，externalId 集合完全一致    → 幂等
6. 传入一个只有导航没有文章的 HTML → 返回 []，不抛异常
7. ⭐ 全库 grep 不到任何 host / 域名 / 信源名的字符串分支
8. fetchMode='discover_only' 的 source，fetch() 抛 FetchBlockedError 且不发起网络请求
```

第 5 条和第 7 条建议写成断言，其余常规单测即可。

## 4. 已知不足（**不要**在这一轮解决）

- **不做分页。** 只抓列表第一页。discover 每天跑一次，第一页足够覆盖一天的更新。
- **不做 slug 归一。** AI 闹有一条 `/zh/ainow/what-kind-of-model-is-the-world`（纯 slug 无数字），
  当前规则把它归成独立形态因而漏掉。少收 1 条，不值得为它放宽 id 判定——放宽会
  让导航链接混进文章组，代价更大。
- **不做发布时间提取。** 列表页格式千差万别，猜错日期比没有日期更糟（会污染
  「本月第 N 场」角标）。留 `null`。
- **不碰那 4 个 JS 渲染的站。**

## 5. 完成后

告诉我，我把 seed 里晚点和 AI 闹的 `⏳ 等 HtmlAdapter` 注释去掉。
届时可用信源从 11 个变成 13 个。
