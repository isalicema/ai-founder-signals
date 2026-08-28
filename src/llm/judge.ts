import { z } from 'zod';
import type { AdmissionCheck, LlmJudge } from '../pipeline/admission/index.js';
import { completeJsonValidated, type UsageLedger } from './provider.js';

const AdmissionSchema = z.object({
  is_founder_interview: z.boolean(),
  confidence: z.number().min(0).max(1),
  reject_reason: z.string().optional().default(''),
});

/**
 * 与 prompts/admission-l2.md 保持一致。改这里必须同步改那份文件。
 *
 * ⚠️ DeepSeek 的 JSON 模式要求 prompt 里出现 "json" 字样并给出格式示例，
 *    否则可能返回非 JSON 或空内容（官方文档明确提示）。
 */
const SYSTEM = `你在判断一条内容是否为「科技创业公司创始人的一手访谈」，并以 json 格式输出结果。

判定标准（四条必须同时成立）：
1. 受访者是科技创业公司的创始人、联合创始人，或在创始阶段有决定性作用的人；
   ⚠️ **不要去裁定这家公司「算不算 AI 公司」。** 信源本身已经做过领域过滤，
   而且当下的开发者工具、基础设施、SaaS 公司几乎都在 AI 这一层里——
   Supabase、Vercel、Cursor、Notion 这类都算。只要是创始人级别的一手表达就通过。
2. 内容形式是对谈/访谈/自述，创始人本人有较大篇幅的第一人称表达；
3. 包含产品、技术、商业、组织、行业或个人经历方面的实质信息；
4. 是一手内容，不是对别处访谈的二手转述、编译或解读。

明确排除：融资新闻、产品发布通稿、财报、榜单、盘点、招聘；分析师/记者的行业评论；
对访谈的二手解读（如「XX 访谈的十个要点」）；创始人只是被引用一两句的报道。

两条重要倾向：
- 不认识这个人、没听过这家公司，都不是拒绝的理由。大量目标内容来自
  没听过的初创公司创始人。只判断「是不是创始人 + 是不是访谈」，
  不判断「这个人有没有名气」，也不判断「这家公司够不够 AI」。
- 不确定时倾向通过。漏掉一场真访谈的代价，远大于混进一条无关内容的代价。

只输出 json，不要任何其它文字。格式示例：
{"is_founder_interview": true, "confidence": 0.82, "reject_reason": ""}

reject_reason 仅在 false 时填一句话说明，true 时填空字符串。`;

export function createLlmJudge(ledger?: UsageLedger): LlmJudge {
  return async ({ title, snippet }): Promise<AdmissionCheck> => {
    const user = `标题：${title}\n摘要/正文前 500 字：${snippet}`;

    const parsed = await completeJsonValidated(
      { task: 'admission', system: SYSTEM, user, maxTokens: 256 },
      (data) => {
        const r = AdmissionSchema.safeParse(data);
        return r.success ? r.data : null;
      },
      { ledger },
    );

    // 校验/重试都失败时保守放行——召回优先于精确（架构文档 §0.4）
    if (!parsed) return { is_founder_interview: true, confidence: 0.5 };

    return {
      is_founder_interview: parsed.is_founder_interview,
      confidence: parsed.confidence,
      ...(parsed.is_founder_interview
        ? {}
        : { reject_reason: parsed.reject_reason || 'llm_rejected' }),
    };
  };
}
