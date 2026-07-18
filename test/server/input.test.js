import { describe, expect, it } from 'vitest';
import { canonicalizeSourceInput } from '../../server/sources/input.js';

describe('canonicalizeSourceInput', () => {
  it('canonicalizes a LiveLaps race ID', () => {
    expect(canonicalizeSourceInput('79103')).toMatchObject({
      provider: 'livelaps',
      sourceRaceId: '79103'
    });
  });

  it('canonicalizes a Moto-Tally results URL', () => {
    expect(
      canonicalizeSourceInput(
        'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'
      )
    ).toMatchObject({ provider: 'mototally', sourceRaceId: 'ECEA/Enduro/2026/6/O1' });
  });

  it('rejects unsupported URLs', () => {
    expect(() => canonicalizeSourceInput('https://example.com/internal')).toThrow(/supported/);
  });
});
