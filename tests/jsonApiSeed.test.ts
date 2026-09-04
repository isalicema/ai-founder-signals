import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../src/db/seed/sources.js';

describe('JSON API source seeds', () => {
  const jsonApi = SEED_SOURCES.filter((source) => source.ingestMethod === 'json_api');

  it('keeps the configured JSON API sources enabled', () => {
    // 锁具名集合而不是数量：数量对不上只告诉你「变了」，
    // 名字对不上才告诉你「谁没了」。
    expect(jsonApi.map((s) => s.name).sort()).toEqual([
      'Founder Park（智源社区镜像）',
      'Z Potentials（腾讯新闻镜像）',
      '暗涌 Waveline（腾讯新闻镜像）',
      '硅星人 Pro（腾讯新闻镜像）',
    ].sort());
    expect(jsonApi.every((source) => source.enabled !== false)).toBe(true);
    expect(jsonApi.every((source) => source.config?.endpoint && source.config.itemsPath)).toBe(true);
  });

  it('pins each 腾讯新闻 mirror to the right author', () => {
    // §4.17 的教训：Lex 那次是 channel ID 配错，标题看不出来，
    // 于是一整条信源默默抓了别人的内容一周。
    // 腾讯镜像同理——guestSuid 抄错不会报错，只会静默换成另一个作者的稿子。
    // 所以把 URL 里的作者 ID 和 query.guestSuid 绑死。
    const mirrors = jsonApi.filter((s) => s.url.includes('news.qq.com/omn/author/'));
    expect(mirrors.length).toBeGreaterThanOrEqual(3);
    for (const s of mirrors) {
      const inUrl = decodeURIComponent(s.url.split('/omn/author/')[1] ?? '');
      expect(s.config?.query?.guestSuid, `${s.name} 的 guestSuid 应与 URL 中的作者 ID 一致`)
        .toBe(inUrl);
    }
  });

  it('keeps 品玩 main site disabled in favour of the 硅星人 Pro mirror', () => {
    // §4.21：品玩主站是 PingWest 全网发布面，85 条只换来 feed 里 1 条。
    // 与 §4.17 停用 Lex Clips 同理——别因为「命中数好看」被改回来。
    const pingwest = SEED_SOURCES.find((s) => s.url === 'https://www.pingwest.com/');
    expect(pingwest, '品玩主站条目应保留在 seed 里（留库以维持 provenance）').toBeDefined();
    expect(pingwest?.enabled).toBe(false);
  });
});
