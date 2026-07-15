import { describe, it, expect, vi, afterEach } from 'vitest';
import { MOTOTALLY_FIXTURE_HTML } from './fixtures/mototally.fixture.js';
import { resolveAndLoadRace, loadRaceById, PROXY_PREFIX } from '../src/mototally.js';

// happy-dom provides DOMParser globally when we assign it; the module uses global DOMParser.
import { Window } from 'happy-dom';
globalThis.DOMParser = new Window().DOMParser;

function mockFetchReturning(html) {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => html }));
}

afterEach(() => vi.restoreAllMocks());

describe('resolveAndLoadRace (overall link)', () => {
  it('fetches the pasted O-page and normalizes it', async () => {
    globalThis.fetch = mockFetchReturning(MOTOTALLY_FIXTURE_HTML);
    const { raceId, raceMeta, allResults } = await resolveAndLoadRace(
      'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'
    );
    expect(raceId).toBe('mototally:ECEA/Enduro/2026/6/O1');
    expect(raceMeta).toEqual({ raceName: '2026 Test Enduro', modeName: 'Enduro' });
    expect(allResults).toHaveLength(3);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PROXY_PREFIX}ECEA/Enduro/Results.aspx/2026/6/O1/CS`);
  });
});

describe('loadRaceById', () => {
  it('re-loads from a mototally descriptor', async () => {
    globalThis.fetch = mockFetchReturning(MOTOTALLY_FIXTURE_HTML);
    const { allResults } = await loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(allResults[0].id).toBe(111);
  });
});
