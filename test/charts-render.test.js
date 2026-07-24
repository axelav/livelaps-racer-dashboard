// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { lineChart } from '../src/charts.js';

function render(opts) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  lineChart(container, { ariaLabel: 'test', ...opts });
  return container;
}

function tickNumbers(container) {
  return Array.from(container.querySelectorAll('text.tick-label'))
    .map((t) => Number(t.textContent))
    .filter((n) => Number.isFinite(n));
}

describe('lineChart domain clamping', () => {
  it('never draws negative ticks for position series clamped at 1', () => {
    const c = render({
      labels: ['a', 'b', 'c'],
      clampMin: 1,
      series: [{ name: 'pos', color: '#000', values: [1, 47, 53] }]
    });
    expect(tickNumbers(c).length).toBeGreaterThan(0);
    expect(Math.min(...tickNumbers(c))).toBeGreaterThanOrEqual(0);
  });

  it('keeps percentile domains inside 0..100', () => {
    const c = render({
      labels: ['a', 'b'],
      clampMin: 0,
      clampMax: 100,
      series: [{ name: 'pct', color: '#000', values: [22, 100] }]
    });
    const ticks = tickNumbers(c);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(100);
  });
});

describe('lineChart axis direction', () => {
  function pointYs(container) {
    return Array.from(container.querySelectorAll('circle.pt')).map((p) => Number(p.getAttribute('cy')));
  }

  it('plots lower values higher by default (positions)', () => {
    const c = render({
      labels: ['a', 'b'],
      series: [{ name: 'pos', color: '#000', values: [1, 50] }]
    });
    const [first, second] = pointYs(c);
    expect(first).toBeLessThan(second);
  });

  it('plots higher values higher with invert: false (percentiles)', () => {
    const c = render({
      labels: ['a', 'b'],
      invert: false,
      series: [{ name: 'pct', color: '#000', values: [20, 90] }]
    });
    const [first, second] = pointYs(c);
    expect(second).toBeLessThan(first);
  });
});
