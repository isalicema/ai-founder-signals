import { SEED_SOURCES } from '../src/db/seed/sources.js';
const on = SEED_SOURCES.filter((s) => s.enabled !== false);
console.log(`启用中: ${on.length}/${SEED_SOURCES.length}`);
console.log('  可跑:', on.filter((s) => s.ingestMethod !== 'html').length, '(youtube/podcast/json_api)');
console.log('  待 HtmlAdapter:', on.filter((s) => s.ingestMethod === 'html').map((s) => s.name).join(', '));
