import { describe, it, expect } from 'vitest';
import { isMotoTallyUrl, parseMotoTallyUrl } from '../src/mototally.js';
import { UnsupportedFormatError, UnparseableInputError } from '../src/livelaps.js';

describe('isMotoTallyUrl', () => {
  it('recognizes moto-tally links, rejects others', () => {
    expect(isMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS')).toBe(true);
    expect(isMotoTallyUrl('https://www.livelaps.com/race/results/79103')).toBe(false);
    expect(isMotoTallyUrl('79103')).toBe(false);
  });
});

describe('parseMotoTallyUrl', () => {
  it('parses an overall-grouping URL', () => {
    expect(parseMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'))
      .toEqual({ org: 'ECEA', discipline: 'Enduro', year: '2026', round: '6', group: 'O1', view: 'CS' });
  });

  it('parses a single-class URL', () => {
    expect(parseMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/C8/CS').group).toBe('C8');
  });

  it('rejects a non-Enduro discipline', () => {
    expect(() => parseMotoTallyUrl('https://www.moto-tally.com/ECEA/HareScramble/Results.aspx/2026/6/O1/CS'))
      .toThrow(UnsupportedFormatError);
  });

  it('rejects unparseable input', () => {
    expect(() => parseMotoTallyUrl('https://www.moto-tally.com/nonsense')).toThrow(UnparseableInputError);
  });
});
