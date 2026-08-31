/**
 * 一级主题闭集 —— 内容负责人 2026-08-29 定稿。
 *
 * ⚠️ 这是封闭集合。LLM 返回集合外的 tag 一律丢弃（见 sanitizeTags）。
 *    不设闭集的话三个月后会有几百个只出现过一次的标签，筛选器彻底不可用。
 */
export const TOPICS = [
  // 在做哪类技术或产品
  '基础模型', 'Agent', 'AI 编程', 'AI 硬件', '机器人',
  // 主要服务谁
  '消费级 AI', '企业服务',
  // 跨品类的关键选择（有实质讨论才选）
  '开源', '安全与治理',
  // 公司如何做成这件事
  '产品与用户', '商业模式', '增长与销售', '市场与竞争', '组织与人才',
  // 个人维度（起步/转型/失败占明显篇幅才选）
  '创业历程',
] as const;

export type Topic = (typeof TOPICS)[number];

const TOPIC_SET: ReadonlySet<string> = new Set(TOPICS);
export const isTopic = (s: string): s is Topic => TOPIC_SET.has(s);

export const MIN_TAGS = 3;
export const MAX_TAGS = 5;

export interface SanitizeResult {
  tags: Topic[];
  dropped: string[];
}

/**
 * 校验并裁剪 LLM 返回的 tags。
 * 丢弃项要留痕——持续出现同一个非法 tag，说明 prompt 或主题体系需要调整。
 */
export function sanitizeTags(raw: unknown): SanitizeResult {
  const arr = Array.isArray(raw) ? raw : [];
  const tags: Topic[] = [];
  const dropped: string[] = [];
  for (const v of arr) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (isTopic(s) && !tags.includes(s)) tags.push(s);
    else if (!isTopic(s)) dropped.push(s);
  }
  return { tags: tags.slice(0, MAX_TAGS), dropped };
}
