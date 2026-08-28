import { createHash } from 'node:crypto';
import type { JsonRequest, JsonResult, LlmProvider, LlmTask } from './types.js';
import { DeepSeekProvider } from './deepseek.js';
import { AnthropicProvider } from './anthropic.js';

export * from './types.js';

/**
 * ⚠️ 这一层绝不记录 raw 正文。台账里只有任务名、模型、token 数、成本
 *    和输入的 sha256 前 12 位。见 tests/llmRedline.test.ts 的断言。
 */

/**
 * $/MTok。DeepSeek 分高峰/平峰两档计价：
 *   高峰 UTC 01:00-04:00 与 06:00-10:00（周一至周五），其余为平峰。
 * 我们的 cron 是北京时间 6:00 = UTC 22:00，落在平峰档。
 */
interface Price { inOff: number; inPeak: number; outOff: number; outPeak: number }
const PRICING: Record<string, Price> = {
  'deepseek-v4-flash': { inOff: 0.22, inPeak: 0.44, outOff: 0.66, outPeak: 1.32 },
  'deepseek-v4-pro': { inOff: 0.66, inPeak: 1.32, outOff: 1.98, outPeak: 3.96 },
  'deepseek-v4-flash-vision-exp': { inOff: 0.22, inPeak: 0.44, outOff: 0.66, outPeak: 1.32 },
  'claude-haiku-4-5': { inOff: 1, inPeak: 1, outOff: 5, outPeak: 5 },
  'claude-sonnet-5': { inOff: 2, inPeak: 2, outOff: 10, outPeak: 10 },
  'claude-opus-5': { inOff: 5, inPeak: 5, outOff: 25, outPeak: 25 },
};

export function isPeakWindow(at: Date = new Date()): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function costOf(model: string, inputTokens: number, outputTokens: number, at?: Date): number {
  const price = PRICING[model];
  if (!price) return 0;
  const peak = isPeakWindow(at);
  const inRate = peak ? price.inPeak : price.inOff;
  const outRate = peak ? price.outPeak : price.outOff;
  return +((inputTokens * inRate + outputTokens * outRate) / 1_000_000).toFixed(6);
}

export interface CallRecord {
  task: LlmTask;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** 输入的 sha256 前 12 位——对账用，**不是内容本身** */
  inputDigest: string;
  ms: number;
  retries: number;
}

export class UsageLedger {
  readonly records: CallRecord[] = [];
  add(record: CallRecord): void { this.records.push(record); }

  get totalUsd(): number {
    return +this.records.reduce((s, r) => s + r.costUsd, 0).toFixed(6);
  }

  summary(): string {
    const by = new Map<string, { n: number; usd: number; retries: number }>();
    for (const r of this.records) {
      const key = `${r.task}/${r.model}`;
      const acc = by.get(key) ?? { n: 0, usd: 0, retries: 0 };
      by.set(key, { n: acc.n + 1, usd: acc.usd + r.costUsd, retries: acc.retries + r.retries });
    }
    const parts = [...by].map(([k, v]) =>
      `${k} x${v.n}${v.retries ? `(+${v.retries}重试)` : ''} $${v.usd.toFixed(4)}`);
    return `llm usage: ${parts.join(' | ')} → total $${this.totalUsd.toFixed(4)}`;
  }
}

export function digestOf(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

let provider: LlmProvider | null = null;

export function llmProvider(): LlmProvider {
  if (!provider) {
    const name = (process.env.AFS_LLM_PROVIDER ?? 'deepseek').trim().toLowerCase();
    provider = name === 'anthropic' ? new AnthropicProvider() : new DeepSeekProvider();
  }
  return provider;
}

/** 仅供测试注入 */
export function __setProvider(next: LlmProvider | null): void { provider = next; }

export interface CallOptions {
  ledger?: UsageLedger;
  /** zod 校验失败或返回空时重试几次。DeepSeek 官方提示可能偶尔返回空内容。 */
  maxRetries?: number;
}

/**
 * 统一的 JSON 调用：调供应商 → 校验 → 失败重试 → 记账。
 *
 * validate 返回 null 表示这次输出不可用（结构不对或为空），会触发重试。
 */
export async function completeJsonValidated<T>(
  request: JsonRequest,
  validate: (data: unknown) => T | null,
  options: CallOptions = {},
): Promise<T | null> {
  const p = llmProvider();
  const maxRetries = options.maxRetries ?? 1;
  const digest = digestOf(request.user);
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const started = Date.now();
    const result: JsonResult = await p.completeJson(request);
    const value = result.data === undefined ? null : validate(result.data);
    options.ledger?.add({
      task: request.task,
      provider: p.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: costOf(result.model, result.inputTokens, result.outputTokens),
      inputDigest: digest,
      ms: Date.now() - started,
      retries,
    });
    if (value !== null) return value;
    retries += 1;
  }
  return null;
}
