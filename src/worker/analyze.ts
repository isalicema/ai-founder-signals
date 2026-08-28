import type { SourceAdapter, DiscoveredItem } from '../adapters/types.js';
import { summarizeItem } from '../llm/summarize.js';
import type { UsageLedger } from '../llm/provider.js';
import type { PersistableAnalysis } from './processItem.js';
import { createHash } from 'node:crypto';

/**
 * adapter.fetch → 摘要 的接缝。
 *
 * ⚠️ 这个函数是 raw 的**唯一合法停留处**：它拿到 EphemeralContent，算完指纹、
 *    生成摘要，然后只返回 PersistableAnalysis——返回类型里没有 rawText，
 *    所以 raw 在类型层面就流不进持久化代码。调用方必须包在 withTempWorkspace 里。
 */
export async function analyzeInWorkspace(
  adapter: SourceAdapter,
  item: DiscoveredItem,
  sourceName: string,
  workspace: string,
  ledger?: UsageLedger,
): Promise<PersistableAnalysis> {
  const content = await adapter.fetch(item, { workspace });

  // 指纹在 raw 还在内存里时算好——「指纹留下，正文丢掉」（架构文档 v1.2 §0.1）
  const contentChars = content.rawText.length;
  const simhash = cheapSimhash(content.rawText);

  const analysis = await summarizeItem(
    { title: item.title, sourceName, body: content.rawText, provenance: content.provenance },
    ledger,
  );

  return {
    summary: analysis.summary,
    tags: analysis.tags,
    persons: analysis.persons,
    companies: analysis.companies,
    modelVersion: analysis.modelVersion,
    contentChars,
    simhash,
  };
}

/** 64 位内容指纹，供去重 L2 用（汉明距 ≤3 视为近似重复） */
export function cheapSimhash(text: string): bigint {
  const normalized = text.replace(/\s+/g, '');
  const bits = new Array<number>(64).fill(0);
  for (let i = 0; i + 3 <= normalized.length; i += 1) {
    const gram = normalized.slice(i, i + 3);
    const digest = createHash('md5').update(gram).digest();
    for (let b = 0; b < 64; b += 1) {
      const bit = ((digest[b >> 3] ?? 0) >> (b & 7)) & 1;
      bits[b] = (bits[b] ?? 0) + (bit ? 1 : -1);
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b += 1) if (bits[b]! > 0) out |= 1n << BigInt(b);
  // ⚠️ Postgres 的 bigint 是**有符号**的（上限 2^63-1）。第 63 位一置就溢出，
  //    实测约 46% 的条目会因此写不进库。asIntN 把它收进有符号区间；
  //    位模式不变，所以汉明距完全不受影响。
  return BigInt.asIntN(64, out);
}

export function hammingDistance(a: bigint, b: bigint): number {
  // 用无符号视图数位，否则负数的符号扩展会让计数跑偏
  let x = BigInt.asUintN(64, a ^ b);
  let n = 0;
  while (x) { x &= x - 1n; n += 1; }
  return n;
}
