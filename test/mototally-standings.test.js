import { describe, it, expect } from 'vitest';
import { deriveStandings } from '../src/mototally.js';

// Same 3 riders as the parse fixture (hand-computed).
const RAW = [
  { id: 111, fullName: 'RIDER A', displayedNumber: '22A', brand: 'BET', className: 'AA', overallPosition: 1, totalTimeSeconds: 300, sectionTimes: [{ seconds: 120, publishedPlace: 2 }, { seconds: 180, publishedPlace: 1 }] },
  { id: 222, fullName: 'RIDER B', displayedNumber: '18A', brand: 'KTM', className: 'AA', overallPosition: 2, totalTimeSeconds: 360, sectionTimes: [{ seconds: 60, publishedPlace: 1 }, { seconds: 300, publishedPlace: 3 }] },
  { id: 333, fullName: 'RIDER C', displayedNumber: '4B', brand: 'GAS', className: 'B', overallPosition: 3, totalTimeSeconds: 420, sectionTimes: [{ seconds: 180, publishedPlace: 3 }, { seconds: 240, publishedPlace: 2 }] }
];

describe('deriveStandings', () => {
  const rows = deriveStandings(RAW);
  const a = rows[0], b = rows[1], c = rows[2];

  it('sets final class position from totals and nulls speed', () => {
    expect(a.classPosition).toBe(1); // A before B within AA
    expect(b.classPosition).toBe(2);
    expect(c.classPosition).toBe(1); // only rider in class B
    expect(a.avgSpeedTotal).toBeNull();
  });

  it('emits leader gaps as H:MM:SS', () => {
    expect(a.overallBehindByLeader).toBe('0:00:00');
    expect(b.overallBehindByLeader).toBe('0:01:00'); // 360-300
    expect(c.classBehindByLeader).toBe('0:00:00');   // class-B leader
  });

  it('derives cumulative overall position per section (order flips)', () => {
    // After section 1 cum: B=60, A=120, C=180  -> B1 A2 C3
    expect([a, b, c].map((r) => r.sections[0].overallPosition)).toEqual([2, 1, 3]);
    // After section 2 cum: A=300, B=360, C=420 -> A1 B2 C3 (== EventPlace)
    expect([a, b, c].map((r) => r.sections[1].overallPosition)).toEqual([1, 2, 3]);
  });

  it('derives cumulative class position and section-only class rank', () => {
    expect(a.sections[1].classPosition).toBe(1); // A leads AA after sec2
    expect(b.sections[0].classPosition).toBe(1); // B leads AA after sec1
    expect(a.sections[0].sectionClassPosition).toBe(2); // A slower than B in sec1
  });

  it('keeps published section-only overall rank and cumulative time', () => {
    expect(a.sections[0].sectionOverallPosition).toBe(2);
    expect(a.sections[1].totalCumulatedTime).toBe('0:05:00');
  });

  it('gap to rider ahead after section 1', () => {
    expect(a.sections[0].overallBehindBy).toBe('0:01:00'); // A(120) - B(60)
    expect(b.sections[0].overallBehindBy).toBe('0:00:00'); // B is leader after sec1
  });

  it('handles a DNF racer: null standings from the missed section on', () => {
    const dnf = deriveStandings([
      RAW[0],
      { id: 999, fullName: 'DNF', displayedNumber: '9Z', brand: 'HON', className: 'AA', overallPosition: 4, totalTimeSeconds: null, sectionTimes: [{ seconds: 90, publishedPlace: 1 }, null] }
    ]);
    const d = dnf.find((r) => r.id === 999);
    expect(d.sections[0].overallPosition).toBe(1);  // 90 < A's 120
    expect(d.sections[1].overallPosition).toBeNull(); // DNF, no cum time
    expect(d.sections[1].totalCumulatedTime).toBeNull();
  });
});
