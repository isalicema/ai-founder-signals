export type LlmTask = 'admission' | 'summary';

export interface JsonRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens: number;
}

export interface JsonResult {
  /** 已解析但**未校验**的 JSON。校验由调用方用 zod 做——见 §说明 */
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * LLM 供应商接口。架构文档 §2：「模型能力通过接口接入，不与单一模型绑定」。
 *
 * ⚠️ 为什么接口只承诺「返回 unknown」而不是泛型强类型：
 *    DeepSeek 只支持 response_format:{type:'json_object'}，**没有 json_schema**，
 *    即服务端不保证结构。Anthropic 的 output_config.format 才有 schema 强约束。
 *    把校验统一放到调用方（zod safeParse + 重试），两个供应商行为才一致——
 *    否则换供应商时会静默退化成「以为有 schema 保证、其实没有」。
 */
export interface LlmProvider {
  readonly name: string;
  modelFor(task: LlmTask): string;
  completeJson(request: JsonRequest): Promise<JsonResult>;
}
