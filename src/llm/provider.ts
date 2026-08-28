import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';

/**
 * LLM 接入层。
 *
 * 架构文档 v2.1 §2：「模型能力通过接口接入，不与单一模型绑定」。
 * 换模型只改环境变量，不改调用点；每条产物都带 modelVersion。
 *
 * ⚠️ 红线：这一层**绝不记录 raw 正文**。日志只有任务名、模型、token 数、
 *    成本和输入的 sha256 前缀。见 tests/llmRedline.test.ts 的断言。
 */

export type LlmTask = 'admission' | 'summary';

/**
 * 默认模型来自架构文档 §2 的成本决策（判定与摘要都用 Haiku 级）。
 * 一条环境变量即可整体上调——摘要质量直接决定「要不要点开原文」，
 * 值得在真实数据上跟更强的模型对比一次再定。
 */
const DEFAULT_MODELS: Record<LlmTask, string> = {
  admission: 'claude-haiku-4-5',
  summary: 'claude-haiku-4-5',
};

/** $/MTok，用于成本埋点。换模型时一并更新。 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};

export function modelFor(task: LlmTask): string {
  const override = process.env[`AFS_MODEL_${task.toUpperCase()}`];
  return override && override.trim() ? override.trim() : DEFAULT_MODELS[task];
}

export interface CallRecord {
  task: LlmTask;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** 输入的 sha256 前 12 位——用于对账和去重，**不是内容本身** */
  inputDigest: string;
  ms: number;
}

/** 一次 worker 运行内的用量台账。跑完打印一行汇总。 */
export class UsageLedger {
  readonly records: CallRecord[] = [];

  add(record: CallRecord): void {
    this.records.push(record);
  }

  get totalUsd(): number {
    return +this.records.reduce((sum, r) => sum + r.costUsd, 0).toFixed(6);
  }

  summary(): string {
    const byTask = new Map<string, { n: number; usd: number }>();
    for (const r of this.records) {
      const key = `${r.task}/${r.model}`;
      const acc = byTask.get(key) ?? { n: 0, usd: 0 };
      byTask.set(key, { n: acc.n + 1, usd: acc.usd + r.costUsd });
    }
    const parts = [...byTask].map(([k, v]) => `${k} x${v.n} $${v.usd.toFixed(4)}`);
    return `llm usage: ${parts.join(' | ')} → total $${this.totalUsd.toFixed(4)}`;
  }
}

export function digestOf(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return +((inputTokens * price.input + outputTokens * price.output) / 1_000_000).toFixed(6);
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  // 零参构造：凭据从 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant auth profile 解析
  client ??= new Anthropic();
  return client;
}

/** 仅供测试注入 */
export function __setClient(next: Anthropic | null): void {
  client = next;
}
