import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createSources } from '../../server/sources/index.js';
import { MOTOTALLY_FIXTURE_HTML } from '../fixtures/mototally.fixture.js';

const LIVE_LAPS_API = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';
const MOTO_TALLY_URL =
  'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS';
const MOTO_TALLY_CALENDAR_URL = 'https://www.moto-tally.com/ECEA/Enduro/Results.aspx';

const LIVE_LAPS_RACE = {
  success: 1,
  message: {
    Race_Name: 'Summer Enduro',
    RACE_MODE_NAME: 'Enduro',
    Event_Date: '2026-07-12'
  }
};

const LIVE_LAPS_RESULTS = {
  data: [{ id: 1 }, { id: 2 }],
  has_more_pages: false,
  total: 2
};

const MOTO_TALLY_CALENDAR_HTML = `
  <table>
    <tr><th>Race#</th><th>Date</th><th>Location</th><th>Club</th></tr>
    <tr><td>6</td><td>7/12/2026</td><td>Scranton, PA</td><td>ECEA</td></tr>
  </table>`;

function responseJson(json) {
  return { ok: true, status: 200, json: async () => json };
}

function responseText(text) {
  return { ok: true, status: 200, text: async () => text };
}

function createTestSources(fetchImpl) {
  return createSources({
    fetchImpl,
    parseHtml: (html) => {
      const window = new Window();
      return new window.DOMParser().parseFromString(html, 'text/html');
    }
  });
}

describe('server timing sources', () => {
  it('loads LiveLaps into an archive-ready record with its raw API artifact', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === `${LIVE_LAPS_API}race/79103`) return responseJson(LIVE_LAPS_RACE);
      if (url === `${LIVE_LAPS_API}race/results/79103?page=1&size=1000`) {
        return responseJson(LIVE_LAPS_RESULTS);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const loaded = await createTestSources(fetchImpl).load('79103');

    expect(loaded.sourceRace).toMatchObject({
      provider: 'livelaps',
      sourceRaceId: '79103',
      canonicalUrl: 'https://www.livelaps.com/livelaps/race/79103',
      raceName: 'Summer Enduro',
      modeName: 'Enduro',
      eventDate: '2026-07-12',
      location: null,
      organizer: null
    });
    expect(loaded.normalized).toEqual({
      raceMeta: { raceName: 'Summer Enduro', modeName: 'Enduro' },
      allResults: LIVE_LAPS_RESULTS.data
    });
    expect(loaded.artifact).toEqual({
      mimeType: 'application/json',
      text: JSON.stringify({ race: LIVE_LAPS_RACE, results: [LIVE_LAPS_RESULTS] })
    });
  });

  it('loads Moto-Tally results and enriches them from the series calendar', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === MOTO_TALLY_URL) return responseText(MOTOTALLY_FIXTURE_HTML);
      if (url === MOTO_TALLY_CALENDAR_URL) return responseText(MOTO_TALLY_CALENDAR_HTML);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const loaded = await createTestSources(fetchImpl).load(MOTO_TALLY_URL);

    expect(loaded.sourceRace).toMatchObject({
      provider: 'mototally',
      sourceRaceId: 'ECEA/Enduro/2026/6/O1',
      canonicalUrl: MOTO_TALLY_URL,
      raceName: '2026 Test Enduro',
      modeName: 'Enduro',
      eventDate: '2026-07-12',
      location: 'Scranton, PA',
      organizer: 'ECEA'
    });
    expect(loaded.normalized.allResults).toHaveLength(3);
    expect(loaded.artifact).toEqual({ mimeType: 'text/html', text: MOTOTALLY_FIXTURE_HTML });
  });

  it('keeps valid Moto-Tally results when its calendar request fails', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === MOTO_TALLY_URL) return responseText(MOTOTALLY_FIXTURE_HTML);
      if (url === MOTO_TALLY_CALENDAR_URL) return { ok: false, status: 503, text: async () => '' };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const loaded = await createTestSources(fetchImpl).load(MOTO_TALLY_URL);

    expect(loaded.normalized.allResults).toHaveLength(3);
    expect(loaded.sourceRace).toMatchObject({
      eventDate: null,
      location: null,
      organizer: null
    });
  });

  it('refreshes using the stored canonical URL', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === `${LIVE_LAPS_API}race/79103`) return responseJson(LIVE_LAPS_RACE);
      if (url === `${LIVE_LAPS_API}race/results/79103?page=1&size=1000`) {
        return responseJson(LIVE_LAPS_RESULTS);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const sources = createTestSources(fetchImpl);

    await sources.refresh({ canonicalUrl: 'https://www.livelaps.com/livelaps/race/79103' });

    expect(fetchImpl).toHaveBeenCalledWith(`${LIVE_LAPS_API}race/79103`);
  });
});
