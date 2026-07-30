import { describe, it, expect, vi, afterEach } from 'vitest';
import * as raceSource from '../src/raceSource.js';
import * as livelaps from '../src/livelaps.js';
import * as mototally from '../src/mototally.js';
import type { NormalizedRace } from '../src/domain.js';

function providerRace<T extends string | number>(raceId: T): NormalizedRace & { raceId: T } {
  return {
    raceId,
    raceMeta: { raceName: 'Test Enduro', modeName: 'Overall' },
    allResults: []
  };
}

afterEach(() => vi.restoreAllMocks());

describe('raceSource dispatch', () => {
  it('routes moto-tally URLs to mototally', async () => {
    const spy = vi.spyOn(mototally, 'resolveAndLoadRace').mockResolvedValue(providerRace('mototally:x'));
    await raceSource.resolveAndLoadRace('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS');
    expect(spy).toHaveBeenCalled();
  });

  it('routes bare IDs / livelaps URLs to livelaps', async () => {
    const spy = vi.spyOn(livelaps, 'resolveAndLoadRace').mockResolvedValue(providerRace(79103));
    await raceSource.resolveAndLoadRace('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('routes mototally descriptors to mototally.loadRaceById', async () => {
    const spy = vi.spyOn(mototally, 'loadRaceById').mockResolvedValue(providerRace('mototally:ECEA/Enduro/2026/6/O1'));
    await raceSource.loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(spy).toHaveBeenCalled();
  });

  it('routes numeric race ids to livelaps.loadRaceById', async () => {
    const spy = vi.spyOn(livelaps, 'loadRaceById').mockResolvedValue(providerRace(79103));
    await raceSource.loadRaceById('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('re-exports deriveTotals', () => {
    expect(raceSource.deriveTotals).toBe(livelaps.deriveTotals);
  });
});
