# JsonApiAdapter 施工说明（M4.5，**优先于 HtmlAdapter**）

> 承接人：星子｜排在 M5 之后、HtmlAdapter 之前
> 线索来自 Alice：irreader 能解析 Founder Park 那个 JS 渲染页面。
> 顺着这条线索查下去，发现了比 irreader 更好的路子——**不需要浏览器**。

## 0. 结论：3 个「发现不了内容」的信源可以恢复，而且数据比抓 HTML 更好

irreader 用的是「动态订阅（能耗+）」= 真浏览器渲染后套 CSS 选择器（`DIV[class="story-item"]>A`）。
它必须这么做，因为它是通用工具，不可能知道每个站的接口。**我们可以知道。**

这些站都是 SPA，页面数据来自 XHR。直接打那个接口，实测结果：

| 信源 | 接口 | 认证 | 实测 | 结论 |
|---|---|---|---|---|
| **Founder Park**（智源） | `POST hub-api.baai.ac.cn/api/v1/stories/user` | 无 | ✅ 6 条，含标题/摘要/时间/封面 | 可恢复 |
| **暗涌 Waveline**（腾讯） | `GET i.news.qq.com/getSubNewsMixedList` | 无 | ✅ 20 条 | 可恢复 |
| **Z Potentials**（腾讯） | 同上，换 `guestSuid` | 无 | ✅ 20 条 | 可恢复 |
| **硅星人 Pro**（36氪） | `POST gateway.36kr.com/api/mis/me/article?sign=…` | **请求签名** | ❌ | **不做**，见 §4 |

比走 HTML 抓取好在三点：

1. **有真实发布时间**——HtmlAdapter 那条路只能填 `null`（列表页格式千差万别，猜日期会污染「本月第 N 场」角标）
2. **有现成摘要**——直接就是 `admissionSnippet`，L2 判定不用再去抓正文
3. **不需要浏览器**——能在 GitHub Actions 里跑，不依赖 Alice 的 Mac 开着

---

## 1. 需要的改动

### 1.1 schema（M2 补丁）

```ts
// source 表新增
config: jsonb('config').$type<SourceConfig>(),

// 放宽 check 约束
check('source_ingest_method_check',
  sql`${table.ingestMethod} in ('rss','youtube','podcast','html','json_api')`)
```

⚠️ **这就是我在 HtmlAdapter spec §2.1 里说的那个逃生舱**：启发式失效时「加数据不是加代码」。
现在有了真实理由，可以加了——**但它只服务 `json_api`，不要顺手给别的适配器也塞配置。**

### 1.2 配置结构

```ts
export interface SourceConfig {
  endpoint: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;      // POST 用
  query?: Record<string, string>;      // GET 用
  headers?: Record<string, string>;    // 通常只需要 Referer
  itemsPath: string;                   // 点分路径，如 'data' / 'data.list'
  map: {
    externalId: string;
    title: string;
    snippet?: string;
    publishedAt?: string;
    coverUrl?: string;
    url?: string;                      // 字段里直接有 URL 时用
    urlTemplate?: string;              // 否则用模板拼，如 'https://x/view/{externalId}'
  };
}
```

**红线不变**：适配器代码里不许出现任何域名/信源名。所有站点差异都在 `config` 里。
新增一个 JSON API 信源 = 插一行数据，**不改一行代码**。

---

## 2. 三份已验证的配置（可直接入库）

### Founder Park（智源社区）

```json
{
  "endpoint": "https://hub-api.baai.ac.cn/api/v1/stories/user",
  "method": "POST",
  "headers": { "Referer": "https://hub.baai.ac.cn/", "Origin": "https://hub.baai.ac.cn" },
  "body": { "page": 1, "catalogName": "stories", "id": "74219", "sort": "new" },
  "itemsPath": "data",
  "map": {
    "externalId": "id", "title": "title", "snippet": "summary",
    "publishedAt": "created_at", "coverUrl": "cover_url",
    "urlTemplate": "https://hub.baai.ac.cn/view/{externalId}"
  }
}
```

⚠️ 注意页面默认传 `"sort":"hot"`，**我们要 `"sort":"new"`**——feed 要的是新增，不是热门。

实测返回样例：
```
57504  Moxt 半年复盘：人和 Agent 组成团队，到底需要什么？        2026-08-28 11:50:17
57485  对话陈炜鹏：Loopit 有了 1500 万件作品之后…               2026-08-27 15:50:24
```

### 暗涌 Waveline / Z Potentials（腾讯新闻，同一接口）

```json
{
  "endpoint": "https://i.news.qq.com/getSubNewsMixedList",
  "method": "GET",
  "headers": { "Referer": "https://news.qq.com/" },
  "query": {
    "offset_info": "", "tabId": "om_index", "caller": "1", "from_scene": "103",
    "guestSuid": "8QIf3n9a7oYauzjc5QE="
  },
  "itemsPath": "…（响应嵌套较深，实现时按实际结构填）",
  "map": { "externalId": "…", "title": "title", "publishedAt": "publish_time" }
}
```

Z Potentials 只换 `guestSuid` 为 `8QIf3nxd5YwYvz/c5wM=`。

⚠️ 腾讯的响应体 300KB、嵌套较深，`itemsPath` 我没有逐层确认，**实现时先 dump 一次响应
再填**。两个源实测都返回 20 条，含 `title` 和 `publish_time`。

---

## 3. 验收标准

```
1. 三个信源各自 discover 返回 ≥5 条，title 非空
2. publishedAt 是真实日期而不是 null / now()
3. ⭐ 同一响应跑两次，externalId 集合一致                    → 幂等
4. ⭐ 全库 grep 不到 baai / qq.com / 36kr / 信源名的字符串   → 红线
5. 接口返回 4xx/5xx → AdapterError(retryable) 且不写脏数据
6. itemsPath 指向不存在的路径 → 返回 []，不抛未捕获异常
7. config 为 null 的 json_api 信源 → AdapterError('invalid_source_config')
8. 走现有 fetchTextResource 的 SSRF 守卫与大小/超时限制，不要另起一套 fetch
```

## 4. 明确不做：36氪

`gateway.36kr.com` 的接口要 `sign` 请求签名。逆向签名算法属于**反爬对抗**——
架构文档 v2.1 §10.1 明确说了这是无底洞且法律边界不清晰，我们不做。

硅星人 Pro 保持 `enabled: false`。它的内容 purity 本来也只有 0.3，损失可接受。
真想要就走 M8 的手动投喂，或者用 irreader 当人肉前置（见 §5）。

## 5. 关于 irreader 本身

**不建议接进管线**。它需要 Alice 的 Mac 开着并运行 GUI 程序，而我们的 worker 设计成
跑在 GitHub Actions 上——引入本地 GUI 依赖会让自动化链路多一个「人不在就断」的环节。

但它是**很好的探路工具**：以后遇到抓不动的站，先用 irreader 试，能解析就说明有路可走，
再去 DevTools 里找它背后的接口。这次就是这么找到的。

## 6. 完成后

三个源从 `enabled: false` 恢复，**可用信源从 11 个变成 14 个**。
届时 HtmlAdapter 只剩晚点和 AI 闹两个客户，优先级可以再往后排。

（注：晚点也有 `POST /site/index` 接口，但它的列表本来就在原始 HTML 里、curl 直接能抓，
实现 HtmlAdapter 时可以顺手看看这个接口是否返回发布时间——有的话就改走 json_api。）
