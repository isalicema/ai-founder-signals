import { SEED_SOURCES } from '../src/db/seed/sources.js';
const on = SEED_SOURCES.filter((s) => s.enabled !== false);
console.log(`启用中: ${on.length}/${SEED_SOURCES.length}`);
console.log('  可跑:', on.length, '(youtube/podcast/json_api/html)');
