import { describe, it, expect } from 'vitest';
import { parseClock, formatHMS } from '../src/time.js';
import { parseDuration } from '../src/livelaps.js';

describe('parseClock', () => {
  it('parses M:SS', () => expect(parseClock('27:35')).toBe(27 * 60 + 35));
  it('parses H:MM:SS', () => expect(parseClock('1:05:20')).toBe(3920));
  it('returns null for blank/dnf', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock(' ')).toBeNull();
  });
});

describe('formatHMS', () => {
  it('always includes an hours component', () => {
    expect(formatHMS(1655)).toBe('0:27:35');
    expect(formatHMS(0)).toBe('0:00:00');
    expect(formatHMS(3920)).toBe('1:05:20');
  });
  it('round-trips through livelaps parseDuration', () => {
    expect(parseDuration(formatHMS(1655))).toBe(1655);
  });
});
