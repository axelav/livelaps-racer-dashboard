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

// Builds a Moto-Tally results page for a given set of AMA#s, reusing the real
// column layout so parseResults/parseAmaSet work. Each rider gets a unique total
// time (index-based) so times stay distinct.
function riderRow(place, ama) {
  const t1 = `${place}:00`;
  const total = `${place + 5}:00`;
  return `<tr class="gvR"><td>${place}</td><td>${ama}</td><td>${place}A</td>` +
    `<td><a href='javascript:getRiderDetail(${place});'>RIDER ${ama}</a></td>` +
    `<td>&nbsp;</td><td>&nbsp;</td><td><span class='bb KTM'>KTM</span></td><td>AA</td>` +
    `<td>${t1}<span style='font-size:6pt'> (${place})</span></td><td>0</td>` +
    `<td>${t1}<span style='font-size:6pt'> (${place})</span></td><td>2</td><td>${total}</td></tr>`;
}

function resolutionPage(amaList) {
  return `
<h1 id="mtR_h1RREventName">2026 Test Enduro</h1>
<select id="mtR_ddlSelectClass">
  <option value="O1">OVERALL Long Course</option>
  <option value="O2">OVERALL A</option>
  <option value="O5">OVERALL C</option>
  <option value="C8">A Senior 40+</option>
</select>
<table id="mtR_gvResults" cellspacing="1" border="0">
  <tr><td colspan="13">Check-by-Check Score by Place</td></tr>
  <tr><td>EventPlace</td><td>AMA#</td><td>Row</td><td>Rider Name</td><td>Club</td><td>Sponsors</td><td>Brand</td><td>Class</td><td>1</td><td>2</td><td>3</td><td>MaxChk</td><td>TotalTime</td></tr>
  ${amaList.map((ama, i) => riderRow(i + 1, ama)).join('\n  ')}
</table>`;
}

describe('resolveAndLoadRace (class link -> overall resolution)', () => {
  it('resolves a pasted C-page up to the largest containing O-page', async () => {
    // C8 riders are a subset. O1 (4 riders) and O2 (3 riders) both contain them;
    // O5 does not. Largest containing overall (O1) must win.
    const pages = {
      C8: resolutionPage([111, 222]),
      O1: resolutionPage([111, 222, 333, 444]),
      O2: resolutionPage([111, 222, 333]),
      O5: resolutionPage([555, 666])
    };
    globalThis.fetch = vi.fn(async (url) => {
      const group = ['O1', 'O2', 'O5', 'C8'].find((g) => url.includes(`/${g}/`));
      return { ok: true, status: 200, text: async () => pages[group] };
    });

    const { raceId, allResults } = await resolveAndLoadRace(
      'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/C8/CS'
    );

    expect(raceId).toBe('mototally:ECEA/Enduro/2026/6/O1');
    expect(allResults).toHaveLength(4); // O1 field, not the 2-rider C8 page
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PROXY_PREFIX}ECEA/Enduro/Results.aspx/2026/6/C8/CS`);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PROXY_PREFIX}ECEA/Enduro/Results.aspx/2026/6/O1/CS`);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PROXY_PREFIX}ECEA/Enduro/Results.aspx/2026/6/O2/CS`);
  });
});

describe('loadRaceById', () => {
  it('re-loads from a mototally descriptor', async () => {
    globalThis.fetch = mockFetchReturning(MOTOTALLY_FIXTURE_HTML);
    const { allResults } = await loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(allResults[0].id).toBe(111);
  });
});
