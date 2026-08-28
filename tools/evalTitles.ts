import { evaluateTitle } from '../src/pipeline/admission/titleSignal.js';
import { readFileSync } from 'node:fs';
const rows = readFileSync('/tmp/titles.tsv','utf-8').trim().split('\n')
  .map(l => l.split('\t')).filter(r => r[1] && !r[1].includes('商业访谈录'));
const tally: Record<string, Record<string, number>> = {};
for (const [src, title] of rows) {
  const v = evaluateTitle(title!).verdict;
  (tally[src!] ??= {})[v] = ((tally[src!] ??= {})[v] ?? 0) + 1;
  console.log(`${v.padEnd(16)} [${src}] ${title}`);
}
console.log('\n=== 按信源汇总 ===');
for (const [s, t] of Object.entries(tally)) console.log(s.padEnd(12), JSON.stringify(t));
