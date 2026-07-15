import { describe, it, expect, vi, afterEach } from 'vitest';
import * as raceSource from '../src/raceSource.js';
import * as livelaps from '../src/livelaps.js';
import * as mototally from '../src/mototally.js';

afterEach(() => vi.restoreAllMocks());

describe('raceSource dispatch', () => {
  it('routes moto-tally URLs to mototally', async () => {
    const spy = vi.spyOn(mototally, 'resolveAndLoadRace').mockResolvedValue({ raceId: 'mototally:x' });
    await raceSource.resolveAndLoadRace('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS');
    expect(spy).toHaveBeenCalled();
  });

  it('routes bare IDs / livelaps URLs to livelaps', async () => {
    const spy = vi.spyOn(livelaps, 'resolveAndLoadRace').mockResolvedValue({ raceId: 79103 });
    await raceSource.resolveAndLoadRace('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('routes mototally descriptors to mototally.loadRaceById', async () => {
    const spy = vi.spyOn(mototally, 'loadRaceById').mockResolvedValue({});
    await raceSource.loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(spy).toHaveBeenCalled();
  });

  it('routes numeric race ids to livelaps.loadRaceById', async () => {
    const spy = vi.spyOn(livelaps, 'loadRaceById').mockResolvedValue({});
    await raceSource.loadRaceById('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('re-exports deriveTotals', () => {
    expect(raceSource.deriveTotals).toBe(livelaps.deriveTotals);
  });
});
