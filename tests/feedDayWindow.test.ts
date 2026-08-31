import { describe, expect, it } from 'vitest';
import { beijingDayWindow } from '../src/feed/data.js';

describe('北京时间 Feed 日窗口', () => {
  it('把北京时间当天换算成左闭右开的 UTC 窗口', () => {
    const window = beijingDayWindow(new Date('2026-08-31T03:25:00.000Z'));

    expect(window.start.toISOString()).toBe('2026-08-30T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('在北京时间零点切换到新的一天', () => {
    const beforeMidnight = beijingDayWindow(new Date('2026-08-30T15:59:59.999Z'));
    const atMidnight = beijingDayWindow(new Date('2026-08-30T16:00:00.000Z'));

    expect(beforeMidnight.start.toISOString()).toBe('2026-08-29T16:00:00.000Z');
    expect(atMidnight.start.toISOString()).toBe('2026-08-30T16:00:00.000Z');
  });
});
