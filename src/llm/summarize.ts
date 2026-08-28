import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { TOPICS, sanitizeTags, type Topic } from '../pipeline/topics.js';
import { checkSummary, stripQuotedSpeech } from './guards.js';
import { anthropic, costOf, digestOf, modelFor, type UsageLedger } from './provider.js';

const AnalysisSchema = z.object({
  summary: z.string(),
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
const SYSTEM = `为这场 AI 创始人访谈生成 feed 卡片信息。

🚫 硬约束：
1. 禁止输出任何引号包裹的原话。不要写「他说："……"」，不要摘录原句，只写概括。
   这个系统不保存原文，无法核验引文，所以一句都不允许编造的空间。
2. tags 只能从下面固定主题里选 3-5 个，不允许自创。
3. 写事实与判断，不写「本文精彩纷呈」「值得一读」这类空话。

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

summary 写法（150-250 字，原文是英文就用英文写）：
压缩成一段，不要分点、不要小标题，按这个顺序：
1. 这场访谈的核心话题是什么；
2. 创始人给出的最具体的 1-2 个判断或做法——要具体：什么数字、什么取舍、什么反直觉的选择；
3. 如果有明显的 PR 叙事成分或未经验证的预测，用一个短句点出来。

判断标准：读完这段，应该能回答「我要不要花 40 分钟看原文」。
写得笼统（「探讨了 Agent 的未来」）等于没写。

persons 填受访者姓名（用文中出现的写法），companies 填公司名。`;

export interface SummarizeInput {
  title: string;
  sourceName: string;
  body: string;
}

export async function summarizeItem(
  input: SummarizeInput,
  ledger?: UsageLedger,
): Promise<ItemAnalysis> {
  const model = modelFor('summary');
  const warnings: string[] = [];
  const content = `标题：${input.title}\n来源：${input.sourceName}\n正文/字幕：\n${input.body}`;

  const call = async (corrective?: string) => {
    const started = Date.now();
    const response = await anthropic().messages.parse({
      model,
      max_tokens: 2048,
      system: corrective ? `${SYSTEM}\n\n⚠️ 上一次输出违反了硬约束 1：${corrective}` : SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(AnalysisSchema) },
    });
    ledger?.add({
      task: 'summary',
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: costOf(model, response.usage.input_tokens, response.usage.output_tokens),
      inputDigest: digestOf(content),
      ms: Date.now() - started,
    });
    return response.parsed_output;
  };

  let parsed = await call();
  if (!parsed) throw new Error('summarize_parse_failed');

  // 引文校验：违规则重试一次，仍违规就直接摘掉引文内容
  let check = checkSummary(parsed.summary);
  if (!check.ok) {
    warnings.push(`quoted_speech_retry:${check.quoted.length}`);
    const retry = await call(`不要出现「${check.quoted[0]?.text.slice(0, 20)}…」这样的引号原话`);
    if (retry) {
      parsed = retry;
      check = checkSummary(parsed.summary);
    }
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
    modelVersion: model,
    warnings,
  };
}
