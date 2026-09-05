import { afterEach, describe, expect, it, vi } from 'vitest';
import { today } from '../src/worker/run.js';

/**
 * 排队幂等键是 `discover:<sourceId>:<today()>`，配 on conflict do nothing，
 * 所以「今天」算错不会报错，只会让当天的定时跑静默空排。
 * 2026-09-05 真实发生过：早上 6 点跑完 `已排 0 个 · 退出码 0`，feed 里却没有新信号。
 */
describe('discover 排队用的日期键', () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    return today();
  };

  it('北京时间 06:00 的定时跑，必须拿到「当天」而不是昨天', () => {
    // 这就是踩坑的那一刻：北京 2026-09-05 06:00 = UTC 2026-09-04 22:00
    expect(at('2026-09-04T22:00:00Z')).toBe('2026-09-05');
  });

  it('北京日界（00:00 / 23:59）两侧不串日', () => {
    expect(at('2026-09-04T16:00:00Z')).toBe('2026-09-05'); // 北京 09-05 00:00
    expect(at('2026-09-04T15:59:59Z')).toBe('2026-09-04'); // 北京 09-04 23:59
  });

  it('白天的手动运行与次日早晨的定时跑，必须落在不同的键上', () => {
    // 这正是原 bug 的杀伤面：两者若同键，手动跑一次就顶掉次日排班
    const manualDaytime = at('2026-09-05T02:00:00Z');   // 北京 09-05 10:00
    const nextMorning   = at('2026-09-05T22:00:00Z');   // 北京 09-06 06:00
    expect(manualDaytime).toBe('2026-09-05');
    expect(nextMorning).toBe('2026-09-06');
    expect(manualDaytime).not.toBe(nextMorning);
  });
});
