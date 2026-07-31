import { describe, it, expect } from 'vitest';
import { niceTicks, scaleY } from '../src/charts.js';

describe('niceTicks', () => {
  it('produces round numbers spanning a normal range', () => {
    expect(niceTicks(130, 253, 4)).toEqual({
      min: 100,
      max: 300,
      ticks: [100, 150, 200, 250, 300]
    });
  });

  it('widens a degenerate (flat) domain instead of dividing by zero', () => {
    expect(niceTicks(13, 13, 4)).toEqual({
      min: 12,
      max: 14,
      ticks: [12, 12.5, 13, 13.5, 14]
    });
  });

  it('handles a small fractional range', () => {
    expect(niceTicks(14.5, 18.5, 4)).toEqual({
      min: 14,
      max: 19,
      ticks: [14, 15, 16, 17, 18, 19]
    });
  });

  it('keeps large position ranges close to their observed values', () => {
    expect(niceTicks(1, 550, 4)).toEqual({
      min: 0,
      max: 600,
      ticks: [0, 200, 400, 600]
    });
  });
});

describe('scaleY', () => {
  const dMin = 130, dMax = 260, pxTop = 16, pxBottom = 194;

  it('maps the domain min to pxTop when inverted (lower value = higher on screen)', () => {
    expect(scaleY(130, dMin, dMax, pxTop, pxBottom, true)).toBe(16);
  });

  it('maps the domain max to pxBottom when inverted', () => {
    expect(scaleY(260, dMin, dMax, pxTop, pxBottom, true)).toBe(194);
  });

  it('maps a midpoint value correctly when inverted', () => {
    expect(scaleY(195, dMin, dMax, pxTop, pxBottom, true)).toBe(105);
  });

  it('maps the domain min to pxBottom when not inverted (bar chart baseline)', () => {
    expect(scaleY(130, dMin, dMax, pxTop, pxBottom, false)).toBe(194);
  });

  it('maps the domain max to pxTop when not inverted', () => {
    expect(scaleY(260, dMin, dMax, pxTop, pxBottom, false)).toBe(16);
  });
});
