import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AdmissionCheck, LlmJudge } from '../pipeline/admission/index.js';
import { anthropic, costOf, digestOf, modelFor, type UsageLedger } from './provider.js';

const AdmissionSchema = z.object({
  is_founder_interview: z.boolean(),
  confidence: z.number(),
  reject_reason: z.string(),
});

/** 与 prompts/admission-l2.md 保持一致。改这里必须同步改那份文件。 */
const SYSTEM = `你在判断一条内容是否为「AI 公司创始人的一手访谈」。

判定标准（四条必须同时成立）：
1. 受访者是 AI 公司的创始人、联合创始人，或在创始阶段有决定性作用的人；
2. 内容形式是对谈/访谈/自述，创始人本人有较大篇幅的第一人称表达；
3. 包含产品、技术、商业、组织、行业或个人经历方面的实质信息；
4. 是一手内容，不是对别处访谈的二手转述、编译或解读。

明确排除：融资新闻、产品发布通稿、财报、榜单、盘点、招聘；分析师/记者的行业评论；
对访谈的二手解读；创始人只是被引用一两句的报道。

两条重要倾向：
- 不认识这个人不是拒绝的理由。大量目标内容来自没听过的初创公司创始人。
  只判断「是不是创始人 + 是不是访谈」，不判断「这个人有没有名气」。
- 不确定时倾向通过。漏掉一场真访谈的代价，远大于混进一条无关内容的代价。

reject_reason 仅在 false 时填写，一句话说明；true 时填空字符串。`;

export function createLlmJudge(ledger?: UsageLedger): LlmJudge {
  return async ({ title, snippet }): Promise<AdmissionCheck> => {
    const model = modelFor('admission');
    const content = `标题：${title}\n摘要/正文前 500 字：${snippet}`;
    const started = Date.now();

    const response = await anthropic().messages.parse({
      model,
      max_tokens: 256,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(AdmissionSchema) },
    });

    const parsed = response.parsed_output;
    ledger?.add({
      task: 'admission',
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: costOf(model, response.usage.input_tokens, response.usage.output_tokens),
      inputDigest: digestOf(content),
      ms: Date.now() - started,
    });

    // 解析失败时保守放行——召回优先于精确（架构文档 §0.4）
    if (!parsed) return { is_founder_interview: true, confidence: 0.5 };

    return {
      is_founder_interview: parsed.is_founder_interview,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      ...(parsed.is_founder_interview ? {} : { reject_reason: parsed.reject_reason || 'llm_rejected' }),
    };
  };
}
