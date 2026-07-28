import { describe, expect, it } from 'vitest';
import {
  addComparisonRider,
  comparisonSetFromParams,
  removeComparisonSlot,
  writeComparisonSet
} from '../src/comparisonSet.js';

describe('URL-owned Comparison Set slots', () => {
  it('reads positional slots without shifting holes', () => {
    const params = new URLSearchParams('race=livelaps%3A79103&id=4758874&compare1=bea%20brown&compare3=cal%20chen');

    expect(comparisonSetFromParams(params)).toEqual([
      'bea brown',
      null,
      'cal chen',
      null,
      null
    ]);
  });

  it('removes a rider without shifting surviving slots', () => {
    const params = new URLSearchParams('compare1=bea%20brown&compare2=dan%20diaz&compare4=eli%20evans');

    removeComparisonSlot(params, 1);

    expect(params.toString()).toBe('compare1=bea+brown&compare4=eli+evans');
    expect(comparisonSetFromParams(params)).toEqual(['bea brown', null, null, 'eli evans', null]);
  });

  it('adds a rider to the lowest free slot', () => {
    const params = new URLSearchParams('compare2=bea%20brown&compare4=cal%20chen');

    const result = addComparisonRider(params, 'Dan Diaz', 'Axel Anderson');

    expect(result).toEqual({ added: true, slot: 0, reason: null });
    expect(comparisonSetFromParams(params)).toEqual(['dan diaz', 'bea brown', null, 'cal chen', null]);
  });

  it('treats duplicates and self-selection as no-ops', () => {
    const params = new URLSearchParams('compare1=bea%20brown');

    expect(addComparisonRider(params, 'Bea Brown', 'Axel Anderson')).toEqual({
      added: false,
      slot: null,
      reason: 'duplicate'
    });
    expect(addComparisonRider(params, 'Axel Anderson', 'Axel Anderson')).toEqual({
      added: false,
      slot: null,
      reason: 'self'
    });
    expect(comparisonSetFromParams(params)).toEqual(['bea brown', null, null, null, null]);
  });

  it('refuses riders when every slot is full', () => {
    const params = new URLSearchParams('compare1=a&compare2=b&compare3=c&compare4=d&compare5=e');

    expect(addComparisonRider(params, 'Frank Foster', 'Axel Anderson')).toEqual({
      added: false,
      slot: null,
      reason: 'full'
    });
  });

  it('writes all slots while preserving unrelated route params', () => {
    const params = new URLSearchParams('race=livelaps%3A79103&id=4758874&compare1=old');

    writeComparisonSet(params, [null, 'bea brown', null, 'cal chen', null]);

    expect(params.toString()).toBe('race=livelaps%3A79103&id=4758874&compare2=bea+brown&compare4=cal+chen');
  });
});
