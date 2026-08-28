import Anthropic from '@anthropic-ai/sdk';
import type { JsonRequest, JsonResult, LlmProvider, LlmTask } from './types.js';
import { safeJsonParse } from './deepseek.js';

const DEFAULTS: Record<LlmTask, string> = {
  admission: 'claude-haiku-4-5',
  summary: 'claude-haiku-4-5',
};

/** 备选供应商。保留是为了「不与单一模型绑定」不只是句口号——换回来只改一条 env。 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly #client: Anthropic;

  constructor(client?: Anthropic) {
    this.#client = client ?? new Anthropic();
  }

  modelFor(task: LlmTask): string {
    const override = process.env[`AFS_MODEL_${task.toUpperCase()}`];
    return override?.trim() || DEFAULTS[task];
  }

  async completeJson(request: JsonRequest): Promise<JsonResult> {
    const model = this.modelFor(request.task);
    const response = await this.#client.messages.create({
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    });
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    return {
      data: text.trim() ? safeJsonParse(text) : undefined,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
    };
  }
}
