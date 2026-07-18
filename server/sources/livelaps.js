import { MultiRaceEventError, UnsupportedFormatError } from '../../src/livelaps.js';

const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';

async function fetchJson(fetchImpl, path) {
  const response = await fetchImpl(API_BASE + path);
  if (!response.ok) {
    throw new Error(`LiveLaps API request failed: ${response.status} ${path}`);
  }
  return response.json();
}

async function resolveRaceId(source, fetchImpl) {
  if (source.inputKind !== 'event') return source.sourceRaceId;

  const event = await fetchJson(fetchImpl, `race/event/${source.eventId}`);
  const races = event.message;
  if (races.length === 0) throw new MultiRaceEventError('This event has no races yet.');
  if (races.length > 1) {
    throw new MultiRaceEventError(
      "This event has multiple races — paste the link for the specific race's results instead."
    );
  }
  return String(races[0].id);
}

async function fetchResults(raceId, fetchImpl) {
  const pages = [];
  const allResults = [];
  for (let page = 1; page <= 500; page += 1) {
    const payload = await fetchJson(fetchImpl, `race/results/${raceId}?page=${page}&size=1000`);
    pages.push(payload);
    allResults.push(...payload.data);
    if (!payload.has_more_pages || allResults.length >= payload.total) break;
  }
  return { pages, allResults };
}

function eventDate(race) {
  return race.Event_Date ?? race.EVENT_DATE ?? race.eventDate ?? race.event_date ?? null;
}

export async function loadLiveLaps(source, { fetchImpl }) {
  const raceId = await resolveRaceId(source, fetchImpl);
  const [racePayload, results] = await Promise.all([
    fetchJson(fetchImpl, `race/${raceId}`),
    fetchResults(raceId, fetchImpl)
  ]);
  const race = racePayload.message;
  const raceMeta = { raceName: race.Race_Name, modeName: race.RACE_MODE_NAME };
  if (raceMeta.modeName !== 'Enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Enduro Breakdown currently works with section-based races."
    );
  }

  return {
    sourceRace: {
      provider: 'livelaps',
      sourceRaceId: String(raceId),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${raceId}`,
      raceName: raceMeta.raceName,
      modeName: raceMeta.modeName,
      eventDate: eventDate(race),
      location: null,
      organizer: null
    },
    normalized: { raceMeta, allResults: results.allResults },
    artifact: {
      mimeType: 'application/json',
      text: JSON.stringify({ race: racePayload, results: results.pages })
    }
  };
}
