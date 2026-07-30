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

describe('lineChart x-axis labels', () => {
  function xTickLabels(container) {
    return Array.from(container.querySelectorAll('text.tick-label'))
      .filter((t) => t.getAttribute('text-anchor') === 'middle')
      .map((t) => t.textContent);
  }

  it('uses sparse date anchors for dense history charts', () => {
    const labels = Array.from({ length: 24 }, (_, i) => `race ${i + 1}`);
    const c = render({
      labels,
      xTick: (i) => `8/${i + 1}`,
      maxXTicks: 6,
      series: [{ name: 'pct', color: '#000', values: labels.map((_, i) => i) }]
    });

    const ticks = xTickLabels(c);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]).toBe('8/1');
    expect(ticks.at(-1)).toBe('8/24');
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

describe('lineChart clamped values', () => {
  it('keeps out-of-range percentile points inside the plot area', () => {
    const c = render({
      labels: ['bad low', 'bad high'],
      invert: false,
      clampMin: 0,
      clampMax: 100,
      series: [{ name: 'pct', color: '#000', values: [-20, 120] }]
    });

    const pointYs = Array.from(c.querySelectorAll('circle.pt')).map((p) => Number(p.getAttribute('cy')));
    expect(pointYs.every((y) => y >= 16 && y <= 194)).toBe(true);
  });
});

describe('lineChart result status markers', () => {
  it('marks official DNFs without dropping their plotted value', () => {
    const c = render({
      labels: ['finish', 'dnf'],
      invert: false,
      series: [
        {
          name: 'pct',
          color: '#000',
          values: [80, 33],
          statuses: ['finished', 'official_dnf'],
          statusLabels: ['', 'DNF after 12 of 14 checks']
        }
      ]
    });

    expect(c.querySelectorAll('circle.pt')).toHaveLength(2);
    expect(c.querySelector('circle.pt-dnf')).not.toBeNull();
  });

  it('shows no-result events as muted baseline markers instead of percentile points', () => {
    const c = render({
      labels: ['finish', 'empty'],
      invert: false,
      series: [
        {
          name: 'pct',
          color: '#000',
          values: [80, null],
          statuses: ['finished', 'no_result'],
          statusLabels: ['', 'No final result']
        }
      ]
    });

    expect(c.querySelectorAll('circle.pt')).toHaveLength(1);
    expect(c.querySelector('circle.pt-no-result')).not.toBeNull();
    expect(c.querySelector('circle.pt-no-result').getAttribute('cy')).toBe('188');
  });
});

describe('lineChart tooltip values', () => {
  it('uses configured tooltip text instead of the plotted numeric value', () => {
    const c = render({
      labels: ['Foggy'],
      series: [
        {
          name: 'Overall position',
          color: '#000',
          values: [47],
          tooltipValues: ['47 / 79 · 42 percentile']
        }
      ]
    });
    const svg = c.querySelector('svg');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 520, height: 220 });
    Object.defineProperty(c, 'clientWidth', { value: 520 });

    c.querySelector('rect.hit').dispatchEvent(new MouseEvent('pointermove', { clientX: 260, clientY: 40 }));

    expect(c.querySelector('.tooltip').textContent).toContain('47 / 79 · 42 percentile');
  });
});
