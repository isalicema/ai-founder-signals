import OpenAI from 'openai';
import type { JsonRequest, JsonResult, LlmProvider, LlmTask } from './types.js';

const DEFAULTS: Record<LlmTask, string> = {
  admission: 'deepseek-v4-flash',
  summary: 'deepseek-v4-flash',
};

export class DeepSeekProvider implements LlmProvider {
  readonly name = 'deepseek';
  #client: OpenAI | null;

  constructor(client?: OpenAI) {
    // ⚠️ 懒构造：OpenAI SDK 在缺 key 时构造即抛，那样连「当前用哪个供应商」
    //    都问不了。把凭据检查推到真正调用时，并给出我们自己的清晰报错。
    this.#client = client ?? null;
  }

  #openai(): OpenAI {
    if (this.#client) return this.#client;
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('缺少 DEEPSEEK_API_KEY —— 在 .env.local 里设置，或改用 AFS_LLM_PROVIDER=anthropic');
    }
    this.#client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    });
    return this.#client;
  }

  modelFor(task: LlmTask): string {
    const override = process.env[`AFS_MODEL_${task.toUpperCase()}`];
    return override?.trim() || DEFAULTS[task];
  }

  async completeJson(request: JsonRequest): Promise<JsonResult> {
    const model = this.modelFor(request.task);
    const response = await this.#openai().chat.completions.create({
      model,
      max_tokens: request.maxTokens,
      // DeepSeek 的 JSON 模式要求 prompt 里出现 "json" 字样，见官方文档
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    return {
      // ⚠️ 官方文档明确提示「可能偶尔返回空内容」，所以空串必须当失败处理而不是当空对象
      data: text.trim() ? safeJsonParse(text) : undefined,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model,
    };
  }
}

/** 兼容模型偶尔用 ```json 围栏包裹的情况 */
export function safeJsonParse(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return undefined; }
    }
    return undefined;
  }
}
