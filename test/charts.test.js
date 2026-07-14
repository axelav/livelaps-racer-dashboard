import { describe, it, expect } from 'vitest';
import { niceTicks } from '../src/charts.js';

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
      max: 20,
      ticks: [14, 16, 18, 20]
    });
  });

  it('handles a zero-based range', () => {
    expect(niceTicks(0, 23.5, 4)).toEqual({
      min: 0,
      max: 40,
      ticks: [0, 20, 40]
    });
  });
});
