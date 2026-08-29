import type { NewSource } from '../schema.js';

/**
 * 信源 seed —— Alice 2026-08-29 提供，妙蛙种子实测校准。
 *
 * ⚠️ purity 的准确定义（模板里我写含糊了，这里以此为准）：
 *    不是「几成是访谈体裁」，而是「几成是 **AI 创始人** 一手访谈」。
 *    因为 purity 的唯一用途是决定「标题无信号时要不要跳过 L2 判定」。
 *    Lex Fridman 体裁纯度 0.95，但嘉宾横跨物理/政治/哲学，AI 创始人纯度只有 0.3——
 *    按 0.95 填会让一堆非创始人长访谈直接跳过判定涌进 feed。
 *
 * ⚠️ fetch_mode 均为实测结果（curl 抓列表页，看链接是否在原始 HTML 里），非猜测。
 *    JS 渲染的站点 curl 拿不到列表 → discover_only，正文靠 browser-helper 人工投喂。
 */
export const SEED_SOURCES: NewSource[] = [
  // ───────────── 国内 ─────────────
  // 说明：这些多为第三方镜像站。原文首发在微信公众号（抓不动），
  // 镜像站反而更好抓——这是 Alice 有意的选择，不是将就。
  {
    name: '晚点 LatePost', url: 'https://www.latepost.com/',
    country: 'CN', language: 'zh', ingestMethod: 'html', fetchMode: 'full', purity: 0.5,
    // ✅ 实测：列表页 /news/dj_detail?id=NNNN 在原始 HTML 里；详情页 481 段约 4.7 万字可直取
    // ⏳ 等 HtmlAdapter（M4 只交付了 rss/podcast/youtube，html 尚无实现）
  },
  {
    name: 'Founder Park（智源社区镜像）', url: 'https://hub.baai.ac.cn/users/74219',
    country: 'CN', language: 'zh', ingestMethod: 'json_api', fetchMode: 'full', purity: 0.8,
    config: {
      endpoint: 'https://hub-api.baai.ac.cn/api/v1/stories/user',
      method: 'POST',
      headers: { Referer: 'https://hub.baai.ac.cn/', Origin: 'https://hub.baai.ac.cn' },
      body: { page: 1, catalogName: 'stories', id: '74219', sort: 'new' },
      itemsPath: 'data',
      map: {
        externalId: 'id', title: 'title', snippet: 'summary', publishedAt: 'created_at',
        coverUrl: 'cover_url', urlTemplate: 'https://hub.baai.ac.cn/view/{externalId}',
      },
    },
    // ✅ 页面虽为 JS 渲染，但已改走无认证 JSON API；实测 6 条且正文页可直接抓取。
  },
  {
    name: '品玩 PingWest（硅星人）', url: 'https://www.pingwest.com/',
    country: 'CN', language: 'zh', ingestMethod: 'html', fetchMode: 'full', purity: 0.3,
    // ✅ 走原始发布方而不是镜像。实测首页服务端渲染，47 条 /a/{id} 在原始 HTML 里，
    //    详情页 17,822 字可直取。三个 html 信源里判据区分度最好（titleish 38 : 5）。
    // ⏳ 等 HtmlAdapter，见 docs/SPEC-HtmlAdapter.md
    //
    // 放弃过的两条路（都是签名式反爬，按 v2.1 §10.1 不做）：
    //   · 36氪镜像 gateway.36kr.com  → 需要 sign 请求签名
    //   · 知乎 @硅星人             → 需要 x-zse-96 签名头（code 10003）
    // ⚠️ purity 0.3：品玩全站发布面比「硅星人 Pro」宽，会混进不少非 AI 创始人内容，
    //    交给 L1 负向词 + L2 过滤。
  },
  {
    name: '暗涌 Waveline（腾讯新闻镜像）',
    url: 'https://news.qq.com/omn/author/8QIf3n9a7oYauzjc5QE%3D',
    country: 'CN', language: 'zh', ingestMethod: 'json_api', fetchMode: 'full', purity: 0.6,
    config: {
      endpoint: 'https://i.news.qq.com/getSubNewsMixedList', method: 'GET',
      headers: { Referer: 'https://news.qq.com/' },
      query: {
        offset_info: '', tabId: 'om_index', caller: '1', from_scene: '103',
        guestSuid: '8QIf3n9a7oYauzjc5QE=',
      },
      itemsPath: 'newslist',
      map: {
        externalId: 'id', title: 'title', snippet: 'abstract', publishedAt: 'time',
        coverUrl: 'thumbnails.0', url: 'url',
      },
    },
    // ✅ 无认证 JSON API 实测 20 条，配置驱动，无站点分支。
  },
  {
    name: 'Z Potentials（腾讯新闻镜像）',
    url: 'https://news.qq.com/omn/author/8QIf3nxd5YwYvz%2Fc5wM%3D',
    country: 'CN', language: 'zh', ingestMethod: 'json_api', fetchMode: 'full', purity: 0.5,
    config: {
      endpoint: 'https://i.news.qq.com/getSubNewsMixedList', method: 'GET',
      headers: { Referer: 'https://news.qq.com/' },
      query: {
        offset_info: '', tabId: 'om_index', caller: '1', from_scene: '103',
        guestSuid: '8QIf3nxd5YwYvz/c5wM=',
      },
      itemsPath: 'newslist',
      map: {
        externalId: 'id', title: 'title', snippet: 'abstract', publishedAt: 'time',
        coverUrl: 'thumbnails.0', url: 'url',
      },
    },
    // ✅ 同一接口只换 guestSuid，实测 20 条。
  },
  {
    name: 'AI 闹', url: 'https://elsewhere.news/zh/ainow',
    country: 'CN', language: 'zh', ingestMethod: 'html', fetchMode: 'full', purity: 0.6,
    // ✅ 实测：列表 /zh/ainow/NNN 在原始 HTML 里，14 条
    // ⏳ 等 HtmlAdapter
  },
  {
    name: '十字路口 Crossing',
    url: 'https://www.xiaoyuzhoufm.com/podcast/60502e253c92d4f62c2a9577',
    country: 'CN', language: 'zh', ingestMethod: 'podcast', fetchMode: 'full', purity: 0.8,
  },
  {
    name: '张小珺｜商业访谈录',
    url: 'https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962',
    country: 'CN', language: 'zh', ingestMethod: 'podcast', fetchMode: 'full', purity: 0.6,
    // ✅ 实测：单集链接在 HTML 里（15 条）
    // ⬇️ Alice 填 0.8，我下调到 0.6：抓到的最新两集是「领读 Kimi K3 技术报告」和
    //    「17 岁 ICML 少年」，都不是创始人访谈。体裁纯但对象不全是创始人。
  },
  {
    name: '跨国串门计划',
    url: 'https://www.xiaoyuzhoufm.com/podcast/670f3da40d2f24f28978736f',
    country: 'CN', language: 'zh', ingestMethod: 'podcast', fetchMode: 'full', purity: 0.7,
    // 注：Alice 提示与海外播客可能重复——去重 L2 指纹层会处理不了（不同载体），
    //     但 feed 里相邻显示即可，MVP 不做跨载体合并（架构文档 §6.1）
  },

  // ───────────── 海外（YouTube，channel_id 已实测解析并验证 RSS 有效） ─────────────
  // ⚠️ 实测结论：英文 YouTube 标题几乎不写体裁词（「对谈/访谈」这类中文约定不存在），
  //    L1 规则命中率极低 → 这批信源基本全靠 L2 判定。
  //    所以 purity 必须按「AI 创始人访谈占比」如实填低，不能填体裁纯度，否则会跳过 L2。
  {
    name: 'Alex Kantrowitz (Big Technology)',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCye1YedIypHffYb8k6Gp9wg',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.4,
    // 混合：新闻速评 + 嘉宾访谈 + 个人 vlog（实测抓到一条爬山视频）
  },
  {
    name: 'Acquired',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCyFqFYfTW2VoIQKylJ04Rtw',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.15,
    // ⚠️ 实测最新 5 条全是公司史研究（Disney/Pixar/Marvel），不是创始人访谈。
    //    建议观察两周，若持续无产出就 enabled=false
  },
  {
    name: 'Greg Isenberg',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCPjNBjflYl0-HQtUvOx0Ibw',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.4,
  },
  {
    name: 'Y Combinator',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxIJaCMEptJjxmmQgGFsnCg',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.5,
    // 创始人故事 + 建议/申请指南混杂
  },
  {
    name: 'EO Global',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UClWTCPVi-AU9TeCN6FkGARg',
    country: 'KR', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.6,
  },
  {
    name: "Lenny's Podcast",
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6t1O76G0jYXOAoYCm153dA',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.3,
    // 体裁几乎全是访谈，但嘉宾多为 PM/增长高管而非创始人
  },
  {
    name: 'a16z',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCQ1VQj-37kl2yS_VUhfQHsw',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.3,
  },
  {
    name: 'Lex Fridman',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJIfeSCssxSC_Dhc5s7woww',
    country: 'US', language: 'en', ingestMethod: 'youtube', fetchMode: 'full', purity: 0.3,
    // ⚠️ 体裁纯度 0.95，但嘉宾横跨物理/政治/哲学；且频道大量发布正片切片（Clips），
    //    去重 L1/L2 挡不住切片（URL 和内容都不同）——观察是否需要按标题过滤 Clips
  },
];
