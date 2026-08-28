/**
 * §4.0 标题形态词表 —— 准入判定 L1 层
 *
 * 设计原则（见架构文档 v2.1 §0.5）：
 *   判定的问题是「这是不是一场一手访谈」，不是「这个人重不重要」。
 *   不依赖人物白名单——白名单会让探测器变成回音室，压低最值得发现的新面孔。
 *
 * ⚠️ 词表是起点不是终点。每条负向命中都会留 reason，跑两周后拿误判样本回来迭代。
 */

export type RuleKind = 'strong_positive' | 'weak_positive' | 'hard_negative' | 'soft_negative';

export interface Rule {
  id: string;
  kind: RuleKind;
  pattern: RegExp;
  note?: string;
}

/** 中文强正向：出现即基本可以确定是访谈体裁 */
const ZH_STRONG: Rule[] = [
  { id: 'zh.duitan', kind: 'strong_positive', pattern: /对谈/ },
  { id: 'zh.fangtan', kind: 'strong_positive', pattern: /访谈/ },
  { id: 'zh.zhuanfang', kind: 'strong_positive', pattern: /专访/ },
  { id: 'zh.shendui', kind: 'strong_positive', pattern: /深度对话|深聊|长谈/ },
  { id: 'zh.koushu', kind: 'strong_positive', pattern: /口述/ },
  { id: 'zh.shilu', kind: 'strong_positive', pattern: /实录/ },
  { id: 'zh.wanzi', kind: 'strong_positive', pattern: /万字/, note: '万字长文/万字访谈，这个品类里几乎只用于长访谈' },
  {
    id: 'zh.duihua',
    kind: 'strong_positive',
    // 「对话」要排掉技术术语：对话式 AI / 对话框 / 多轮对话 / 对话系统
    pattern: /(^|[《【\[|\s—－·、,，:：])对话(?!式|框|系统|模型|能力|数据|轮)/,
    note: '「对话XX」是国内访谈标题的高频形态，但需排除技术术语用法',
  },
  { id: 'zh.women_liao', kind: 'strong_positive', pattern: /我们(和|与|跟)[^，。]{1,20}(聊|谈)/ },
];

/** 中文弱正向：提高优先级，但仍需 L2 兜底 */
const ZH_WEAK: Rule[] = [
  { id: 'zh.zishu', kind: 'weak_positive', pattern: /自述/ },
  { id: 'zh.fupan', kind: 'weak_positive', pattern: /复盘/ },
  { id: 'zh.neibuxin', kind: 'weak_positive', pattern: /内部信/ },
  { id: 'zh.chuangshiren_shuo', kind: 'weak_positive', pattern: /创始人(说|谈|讲)/ },
  { id: 'zh.qa', kind: 'weak_positive', pattern: /\bQ&A\b/i },
];

/**
 * 中文硬负向：几乎不可能与真访谈共存，命中即 folded（强正向也压不过）
 */
const ZH_HARD_NEG: Rule[] = [
  { id: 'zh.bangdan', kind: 'hard_negative', pattern: /榜单|排行榜|排行|盘点|年度评选/ },
  { id: 'zh.zhaopin', kind: 'hard_negative', pattern: /招聘|报名|课程|直播预告|活动预告/ },
  { id: 'zh.caibao', kind: 'hard_negative', pattern: /财报|营收报告|季度业绩/ },
];

/**
 * 中文软负向：新闻报道特征，但强正向可以压过它
 * （「对话XX：为什么我们拒绝了融资」是访谈，不是融资新闻）
 */
const ZH_SOFT_NEG: Rule[] = [
  { id: 'zh.rongzi', kind: 'soft_negative', pattern: /融资|完成[^，。]{0,6}轮|领投|跟投|估值/ },
  { id: 'zh.fabu', kind: 'soft_negative', pattern: /宣布|发布|上线|开源了|正式推出/ },
  { id: 'zh.bianDong', kind: 'soft_negative', pattern: /裁员|收购|被曝|据悉|消息人士|知情人士/ },
];

/** 英文强正向 */
const EN_STRONG: Rule[] = [
  { id: 'en.interview', kind: 'strong_positive', pattern: /\binterviews?\b/i },
  { id: 'en.in_conversation', kind: 'strong_positive', pattern: /\bin conversation with\b/i },
  { id: 'en.sits_down', kind: 'strong_positive', pattern: /\bsits down with\b/i },
  { id: 'en.talks_with', kind: 'strong_positive', pattern: /\btalks? with\b/i },
  { id: 'en.fireside', kind: 'strong_positive', pattern: /\bfireside\b/i },
  { id: 'en.ama', kind: 'strong_positive', pattern: /\bAMA\b/ },
  { id: 'en.on_building', kind: 'strong_positive', pattern: /\bon (building|why|how|what)\b/i },
];

const EN_WEAK: Rule[] = [
  { id: 'en.podcast_ep', kind: 'weak_positive', pattern: /\b(ep\.?|episode)\s*#?\d+/i },
  { id: 'en.founder_of', kind: 'weak_positive', pattern: /\b(co-)?founder (of|&|and)\b/i },
];

const EN_HARD_NEG: Rule[] = [
  { id: 'en.ranking', kind: 'hard_negative', pattern: /\b(ranking|roundup|round-up|top \d+|best \d+)\b/i },
  { id: 'en.hiring', kind: 'hard_negative', pattern: /\b(we'?re hiring|job opening|register now)\b/i },
  { id: 'en.earnings', kind: 'hard_negative', pattern: /\b(earnings|quarterly results)\b/i },
];

const EN_SOFT_NEG: Rule[] = [
  { id: 'en.funding', kind: 'soft_negative', pattern: /\b(raises|raised|funding round|series [a-e]\b|valuation)\b/i },
  { id: 'en.launch', kind: 'soft_negative', pattern: /\b(launches|announces|unveils|releases)\b/i },
  { id: 'en.corp', kind: 'soft_negative', pattern: /\b(layoffs|acquires|acquisition)\b/i },
];

export const RULES: Rule[] = [
  ...ZH_STRONG, ...ZH_WEAK, ...ZH_HARD_NEG, ...ZH_SOFT_NEG,
  ...EN_STRONG, ...EN_WEAK, ...EN_HARD_NEG, ...EN_SOFT_NEG,
];

/** YouTube / 播客标题里用分隔符挂嘉宾名的形态，算弱正向 */
export const GUEST_SEPARATOR = /\s(\||—|–|w\/|with)\s/i;
