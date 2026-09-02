import { z } from 'zod';
import { TOPICS, sanitizeTags, type Topic } from '../pipeline/topics.js';
import { checkSummary, stripQuotedSpeech } from './guards.js';
import { completeJsonValidated, llmProvider, type UsageLedger } from './provider.js';

const AnalysisSchema = z.object({
  summary: z.string().min(1),
  tags: z.array(z.string()),
  persons: z.array(z.string()),
  companies: z.array(z.string()),
});

export interface ItemAnalysis {
  summary: string;
  tags: Topic[];
  persons: string[];
  companies: string[];
  modelVersion: string;
  /** 观测用：被丢弃的非法 tag、引文违规、长度告警。持续出现同一项说明 prompt 该调 */
  warnings: string[];
}

/** 与 prompts/summarize.md 保持一致。改这里必须同步改那份文件。 */
const SYSTEM = `为这场 AI 创始人访谈生成 feed 卡片信息，以 json 格式输出。

🚫 硬约束：
1. 禁止输出任何引号包裹的原话。不要写「他说："……"」，不要摘录原句，只写概括。
   这个系统不保存原文，无法核验引文，所以一句都不允许编造的空间。
2. summary 必须使用简体中文。即使标题、正文或字幕是英文，也要用中文概括；
   DHH、Agent、ARR 等人名、品牌名、产品名和专有术语可保留英文。
3. tags 只能从下面固定主题里选 3-5 个，不允许自创。
4. 写事实与判断，不写「本文精彩纷呈」「值得一读」这类空话。

一级主题（只能从这些里选）：
${TOPICS.join(' / ')}

选标签的原则：
- 选 3-5 个，不是把能沾边的全贴上；按访谈篇幅和重要性排序，不按标题关键词数量。
- 「基础模型/Agent/AI 编程/AI 硬件/机器人」回答在做哪类技术或产品。
- 「消费级 AI/企业服务」回答主要服务谁，可并存。
- 「产品与用户/商业模式/增长与销售/市场与竞争/组织与人才」回答公司如何做成这件事。
- 「开源/安全与治理」只有访谈有实质讨论时才选，用了开源模型不等于该贴「开源」。
- 「创业历程」只在起步、转型、失败或个人经历占明显篇幅时用。
- 地区不进 tags。融资不是独立主题，谈融资策略/现金流/资本效率时用「商业模式」。

summary 写法（150-250 个汉字，统一使用简体中文）：
压缩成一段，不要分点、不要小标题，按这个顺序：
1. 这场访谈的核心话题是什么；
2. 创始人给出的最具体的 1-2 个判断或做法——要具体：什么数字、什么取舍、什么反直觉的选择；
3. 如果有明显的 PR 叙事成分或未经验证的预测，用一个短句点出来。

判断标准：读完这段，应该能回答「我要不要花 40 分钟看原文」。
写得笼统（「探讨了 Agent 的未来」）等于没写。

persons 填受访者姓名（用文中出现的写法），companies 填公司名。

只输出 json，不要任何其它文字。格式示例：
{"summary": "……", "tags": ["Agent", "商业模式", "组织与人才"], "persons": ["某某某"], "companies": ["某公司"]}`;

/**
 * 送进摘要的正文上限。
 *
 * 实测一条 78,992 字的 YouTube 字幕连续两次让模型返回不合法结构
 * （summarize_parse_failed），白花 $0.0114。而我们只要 200 字概括，
 * 不需要读完整场。头尾各留一段：开头有嘉宾与议题，结尾常有总结与判断，
 * 中间重复度最高。
 */
export const MAX_BODY_CHARS = 40_000;

export class SummarizeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'SummarizeError';
    this.code = code;
  }
}

export function clampBody(body: string, max = MAX_BODY_CHARS): { text: string; clamped: boolean } {
  if (body.length <= max) return { text: body, clamped: false };
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return {
    text: `${body.slice(0, head)}\n\n［中间省略 ${body.length - max} 字］\n\n${body.slice(-tail)}`,
    clamped: true,
  };
}

export interface SummarizeInput {
  title: string;
  sourceName: string;
  body: string;
  provenance?: 'body' | 'transcript' | 'shownotes';
}

/**
 * 按正文来源追加的约束。
 *
 * 由来：小宇宙不给逐字稿，我们改用单集页内嵌的 show notes。但 show notes 是
 * **节目方撰写的说明与大纲，不是对话实录**——基于它生成的摘要若写成
 * 「创始人说……」就是在冒充第一人称表达。前端负责人在 M4 里为此专门写过一条测试
 * 拒绝把 show notes 当逐字稿，这个顾虑是对的，所以做成显式约束而不是绕过。
 */
const PROVENANCE_NOTE: Record<string, string> = {
  shownotes:
    '\n\n⚠️ 本次输入是**节目方撰写的单集说明/大纲（show notes）**，不是对话实录。\n' +
    '- 只概括其中确有的信息，不要虚构对话细节，不要写成受访者的第一人称表达；\n' +
    '- 大纲能说明「这期会谈什么」，但说明不了「实际谈出了什么」——\n' +
    '  写不出具体判断时就如实概括议题范围，不要为了显得具体而编造数字或结论。',
  transcript:
    '\n\n本次输入是视频字幕转写，可能有断句错误和错别字，按语义理解即可。',
};

export async function summarizeItem(
  input: SummarizeInput,
  ledger?: UsageLedger,
): Promise<ItemAnalysis> {
  const warnings: string[] = [];
  const { text: body, clamped } = clampBody(input.body);
  if (clamped) warnings.push(`body_clamped:${input.body.length}→${MAX_BODY_CHARS}`);
  const content = `标题：${input.title}\n来源：${input.sourceName}\n正文/字幕：\n${body}`;

  const provenanceNote = PROVENANCE_NOTE[input.provenance ?? 'body'] ?? '';
  const base = SYSTEM + provenanceNote;

  const call = async (corrective?: string) =>
    completeJsonValidated(
      {
        task: 'summary',
        system: corrective ? `${base}\n\n⚠️ 上一次输出违反了硬约束：${corrective}` : base,
        user: content,
        maxTokens: 2048,
      },
      (data) => {
        const r = AnalysisSchema.safeParse(data);
        return r.success ? r.data : null;
      },
      { ledger, maxRetries: 2 },
    );

  let parsed = await call();
  if (!parsed) throw new SummarizeError('summarize_parse_failed');

  // 语言与引文校验：违规则带具体原因重试一次。
  let check = checkSummary(parsed.summary);
  if (!check.ok) {
    const corrections: string[] = [];
    if (!check.languageOk) {
      warnings.push('summary_language_retry');
      corrections.push('summary 必须以简体中文为主，英文只保留人名、品牌名、产品名和专有术语');
    }
    if (check.quoted.length > 0) {
      warnings.push(`quoted_speech_retry:${check.quoted.length}`);
      corrections.push(`不要出现「${check.quoted[0]?.text.slice(0, 20)}…」这样的引号原话`);
    }
    const retry = await call(corrections.join('；'));
    if (retry) {
      parsed = retry;
      check = checkSummary(parsed.summary);
    }
  }
  if (!check.languageOk) {
    warnings.push('summary_language_failed');
    throw new SummarizeError('summary_language_failed');
  }
  let summary = parsed.summary;
  if (!check.ok) {
    warnings.push(`quoted_speech_stripped:${check.quoted.length}`);
    summary = stripQuotedSpeech(summary);
  }
  if (check.lengthWarning) warnings.push(check.lengthWarning);

  const { tags, dropped } = sanitizeTags(parsed.tags);
  if (dropped.length) warnings.push(`tags_dropped:${dropped.join('|')}`);

  return {
    summary: summary.trim(),
    tags,
    persons: parsed.persons.map((p) => p.trim()).filter(Boolean),
    companies: parsed.companies.map((c) => c.trim()).filter(Boolean),
    modelVersion: `${llmProvider().name}/${llmProvider().modelFor('summary')}`,
    warnings,
  };
}
