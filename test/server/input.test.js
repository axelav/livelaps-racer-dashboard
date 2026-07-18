import { describe, expect, it } from 'vitest';
import { canonicalizeSourceInput } from '../../server/sources/input.js';

describe('canonicalizeSourceInput', () => {
  it('canonicalizes a LiveLaps race ID', () => {
    expect(canonicalizeSourceInput('79103')).toMatchObject({
      provider: 'livelaps',
      inputKind: 'race',
      sourceRaceId: '79103'
    });
  });

  it('canonicalizes a Moto-Tally results URL', () => {
    expect(
      canonicalizeSourceInput(
        'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'
      )
    ).toMatchObject({
      provider: 'mototally',
      inputKind: 'race',
      sourceRaceId: 'ECEA/Enduro/2026/6/O1'
    });
  });

  it('rejects unsupported URLs', () => {
    expect(() => canonicalizeSourceInput('https://example.com/internal')).toThrow(/supported/);
  });

  it('rejects a LiveLaps URL whose query only resembles a race path', () => {
    expect(() =>
      canonicalizeSourceInput('https://www.livelaps.com/nope?redirect=/race/79103')
    ).toThrow(/supported/);
  });

  it('rejects a Moto-Tally URL whose query only resembles a results path', () => {
    expect(() =>
      canonicalizeSourceInput(
        'https://www.moto-tally.com/nope?redirect=/ECEA/Enduro/Results.aspx/2026/6/O1/CS'
      )
    ).toThrow(/supported/);
  });

  it('rejects non-URL text that only resembles a race path', () => {
    expect(() => canonicalizeSourceInput('anything/race/79103')).toThrow(/supported/);
  });

  it('preserves a LiveLaps event input without inventing a race ID', () => {
    const source = canonicalizeSourceInput(
      'https://www.livelaps.com/livelaps/eventScores/23827'
    );

    expect(source).toMatchObject({
      provider: 'livelaps',
      inputKind: 'event',
      eventId: '23827',
      canonicalUrl: 'https://www.livelaps.com/livelaps/eventScores/23827'
    });
    expect(source).not.toHaveProperty('sourceRaceId');
  });
});
