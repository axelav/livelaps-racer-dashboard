import type { LoadedRace, RaceEntry, RaceMeta } from '../../src/domain.js';
import { MultiRaceEventError, UnsupportedFormatError } from '../../src/livelaps.js';
import type { FetchLike, SourceDependencies, SourceResponse } from './index.js';
import type { LiveLapsSourceInput } from './input.js';

const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';

type LiveLapsRace = {
  Race_Name: string;
  RACE_MODE_NAME: string;
  Event_Date?: string | null;
  EVENT_DATE?: string | null;
  eventDate?: string | null;
  event_date?: string | null;
  Promoter_Name?: string | null;
};

type LiveLapsRacePayload = {
  message: LiveLapsRace;
};

type LiveLapsEventRace = {
  id: string | number;
};

type LiveLapsEventPayload = {
  message: LiveLapsEventRace[];
};

type LiveLapsResultsPage = {
  data: RaceEntry[];
  has_more_pages: boolean;
  total: number;
};

async function responseJson<T>(response: SourceResponse): Promise<T> {
  if (typeof response.json !== 'function') throw new TypeError('LiveLaps response is not JSON-readable.');
  return (await response.json()) as T;
}

async function fetchJson<T>(fetchImpl: FetchLike, path: string): Promise<T> {
  const response = await fetchImpl(API_BASE + path);
  if (!response.ok) {
    throw new Error(`LiveLaps API request failed: ${response.status} ${path}`);
  }
  return responseJson<T>(response);
}

async function resolveRaceId(source: LiveLapsSourceInput, fetchImpl: FetchLike): Promise<string> {
  if (source.inputKind !== 'event') return source.sourceRaceId;

  const event = await fetchJson<LiveLapsEventPayload>(fetchImpl, `race/event/${source.eventId}`);
  const races = event.message;
  if (races.length === 0) throw new MultiRaceEventError('This event has no races yet.');
  if (races.length > 1) {
    throw new MultiRaceEventError(
      "This event has multiple races — paste the link for the specific race's results instead."
    );
  }
  const [race] = races;
  if (!race) throw new MultiRaceEventError('This event has no races yet.');
  return String(race.id);
}

async function fetchResults(raceId: string, fetchImpl: FetchLike): Promise<{ pages: LiveLapsResultsPage[]; allResults: RaceEntry[] }> {
  const pages: LiveLapsResultsPage[] = [];
  const allResults: RaceEntry[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const payload = await fetchJson<LiveLapsResultsPage>(fetchImpl, `race/results/${raceId}?page=${page}&size=1000`);
    pages.push(payload);
    allResults.push(...payload.data);
    if (!payload.has_more_pages || allResults.length >= payload.total) break;
  }
  return { pages, allResults };
}

function eventDate(race: LiveLapsRace): string | null {
  return race.Event_Date ?? race.EVENT_DATE ?? race.eventDate ?? race.event_date ?? null;
}

export async function loadLiveLaps(source: LiveLapsSourceInput, { fetchImpl }: SourceDependencies): Promise<LoadedRace> {
  const raceId = await resolveRaceId(source, fetchImpl);
  const [racePayload, results] = await Promise.all([
    fetchJson<LiveLapsRacePayload>(fetchImpl, `race/${raceId}`),
    fetchResults(raceId, fetchImpl)
  ]);
  const race = racePayload.message;
  const raceMeta: RaceMeta = { raceName: race.Race_Name, modeName: race.RACE_MODE_NAME };
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
      organizer: race.Promoter_Name ?? null
    },
    normalized: { raceMeta, allResults: results.allResults },
    artifact: {
      mimeType: 'application/json',
      text: JSON.stringify({ race: racePayload, results: results.pages })
    }
  };
}
