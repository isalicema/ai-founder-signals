/**
 * 证书链自检。用来判断 certs/ 里那份额外根证书还需不需要。
 *
 *   npx tsx tools/chkCerts.ts                          # 按当前环境
 *   NODE_EXTRA_CA_CERTS= npx tsx tools/chkCerts.ts     # 强制不带额外 CA
 */
const HOSTS = ['https://www.latepost.com/', 'https://www.pingwest.com/', 'https://elsewhere.news/zh/ainow'];
console.log(`NODE_EXTRA_CA_CERTS = ${process.env.NODE_EXTRA_CA_CERTS || '(未设置)'}\n`);
let bad = 0;
for (const url of HOSTS) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'AI-Founder-Signals/0.1' } });
    console.log(`✅ ${r.status}  ${url}`);
  } catch (error) {
    bad += 1;
    const cause = (error as { cause?: { code?: string } }).cause;
    console.log(`❌ ${url}\n   ${cause?.code ?? (error as Error).message}`);
  }
}
if (bad === 0 && !process.env.NODE_EXTRA_CA_CERTS) {
  console.log('\n🎉 不带额外 CA 也全通——certs/ 那份可以删了，同时去掉脚本里的 NODE_EXTRA_CA_CERTS。');
}
process.exitCode = bad > 0 ? 1 : 0;
