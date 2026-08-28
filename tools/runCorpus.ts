import { admit } from '../src/pipeline/admission/index.js';
import { POSITIVE, NEGATIVE } from './corpus.js';
const A = { mediaType: 'article' as const, contentChars: 9000 };
console.log('=== 正例（应通过；无 L2 时保守放行也算过）===');
for (const c of POSITIVE) {
  const r = await admit({ title: c.t, ...A, source: { purity: c.purity } });
  console.log(`${r.accepted ? '✅' : '❌'} [${r.titleSignal.verdict.padEnd(15)}] ${c.t.slice(0, 58)}`);
}
console.log('\n=== 反例（L1 应直接判负，不该走到 L2）===');
for (const c of NEGATIVE) {
  const r = await admit({ title: c.t, ...A, source: { purity: c.purity } });
  const ok = !r.accepted;
  console.log(`${ok ? '✅' : '❌ 误收'} [${r.titleSignal.verdict.padEnd(15)}] (${c.kind}) ${c.t.slice(0, 44)}`);
}
