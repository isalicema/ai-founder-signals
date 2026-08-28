import { createDefaultAdapterRegistry } from '../src/adapters/registry.js';
import { SEED_SOURCES } from '../src/db/seed/sources.js';
const reg = createDefaultAdapterRegistry();
const bad: string[] = [];
const byKind: Record<string, number> = {};
for (const s of SEED_SOURCES) {
  byKind[s.ingestMethod!] = (byKind[s.ingestMethod!] ?? 0) + 1;
  try {
    reg.forSource({ id: 'x', name: s.name!, url: s.url!, language: s.language ?? null,
      ingestMethod: s.ingestMethod!, fetchMode: s.fetchMode! } as never);
  } catch { bad.push(`${s.ingestMethod!.padEnd(8)} ${s.name}`); }
}
console.log('seed 信源:', SEED_SOURCES.length, JSON.stringify(byKind));
console.log('无适配器:', bad.length);
bad.forEach((b) => console.log('  ❌', b));
