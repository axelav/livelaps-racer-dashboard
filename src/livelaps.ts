import type { NormalizedRace, RaceEntry, RaceMeta, TimedSection } from './domain.js';

const RACE_ID_PATTERNS = [/race\/results\/(\d+)/, /race\/filters\/(\d+)/, /race\/config\/(\d+)/, /race\/(\d+)/];
const EVENT_ID_PATTERN = /eventScores\/(\d+)/;

const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';

type FetchLike = typeof fetch;

type ParsedRaceId = {
  id: number;
  isEvent: boolean;
};

type LiveLapsRaceResponse = {
  message: {
    Race_Name: string;
    RACE_MODE_NAME: string;
  };
};

type LiveLapsPagedResults = {
  data: LiveLapsRaceEntry[];
  has_more_pages: boolean;
  total: number;
};

type LiveLapsEventRace = {
  id: number;
};

type LiveLapsEventResponse = {
  message: LiveLapsEventRace[];
};

export type LiveLapsRaceEntry = RaceEntry & {
  id: string | number;
  fullName: string;
  displayedNumber: string | number;
  brand: string;
  className: string;
  overallPosition: number;
  classPosition: number;
  sections: TimedSection[];
};

export type DerivedTotals<T extends RaceEntry = RaceEntry> = {
  racer: T;
  fieldSize: number;
  classSize: number;
};

export type SectionSeries = {
  names: string[];
  cumTimes: (string | null)[];
  cumulativeOverallPositions: (number | null)[];
  cumulativeClassPositions: (number | null)[];
  sectionOnlyOverallRanks: (number | null)[];
  sectionOnlyClassRanks: (number | null)[];
  avgSpeeds: number[];
  gapAheadSeconds: number[];
};

export class UnparseableInputError extends Error {}
export class MultiRaceEventError extends Error {}
export class UnsupportedFormatError extends Error {}

export function parseRaceId(input: unknown): ParsedRaceId | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const eventMatch = trimmed.match(EVENT_ID_PATTERN);
  if (eventMatch) return { id: Number(eventMatch[1]), isEvent: true };

  for (const pattern of RACE_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return { id: Number(match[1]), isEvent: false };
  }

  if (/^\d+$/.test(trimmed)) return { id: Number(trimmed), isEvent: false };

  return null;
}

export function parseDuration(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function deriveTotals<T extends RaceEntry>(allResults: readonly T[], participantId: string | number | null): DerivedTotals<T> | null {
  const racer = allResults.find((r) => r.id === participantId);
  if (!racer) return null;
  const classSize = allResults.filter((r) => r.className === racer.className).length;
  return { racer, fieldSize: allResults.length, classSize };
}

export function deriveSectionSeries(racer: { sections: readonly TimedSection[] }): SectionSeries {
  const sections = racer.sections;
  return {
    names: sections.map((s) => s.sectionName),
    cumTimes: sections.map((s) => s.totalCumulatedTime),
    cumulativeOverallPositions: sections.map((s) => s.overallPosition),
    cumulativeClassPositions: sections.map((s) => s.classPosition),
    sectionOnlyOverallRanks: sections.map((s) => s.sectionOverallPosition),
    sectionOnlyClassRanks: sections.map((s) => s.sectionClassPosition),
    avgSpeeds: sections.map((s) => parseFloat(String(s.avgSpeed))),
    gapAheadSeconds: sections.map((s) => parseDuration(s.overallBehindBy))
  };
}

async function apiGet<T>(path: string, fetchImpl: FetchLike = globalThis.fetch): Promise<T> {
  const response = await fetchImpl(API_BASE + path);
  if (!response.ok) {
    throw new Error(`LiveLaps API request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchRace(raceId: string | number, fetchImpl?: FetchLike): Promise<RaceMeta> {
  const json = await apiGet<LiveLapsRaceResponse>(`race/${raceId}`, fetchImpl);
  return { raceName: json.message.Race_Name, modeName: json.message.RACE_MODE_NAME };
}

export async function fetchAllResults(raceId: string | number, fetchImpl?: FetchLike): Promise<LiveLapsRaceEntry[]> {
  let page = 1;
  let all: LiveLapsRaceEntry[] = [];
  while (page <= 500) {
    const json = await apiGet<LiveLapsPagedResults>(`race/results/${raceId}?page=${page}&size=1000`, fetchImpl);
    all = all.concat(json.data);
    if (!json.has_more_pages || all.length >= json.total) break;
    page += 1;
  }
  return all;
}

export async function fetchEventRaces(eventId: string | number, fetchImpl?: FetchLike): Promise<LiveLapsEventRace[]> {
  const json = await apiGet<LiveLapsEventResponse>(`race/event/${eventId}`, fetchImpl);
  return json.message;
}

export async function loadRaceById(raceId: string | number, fetchImpl?: FetchLike): Promise<NormalizedRace & { raceId: string | number }> {
  const [raceMeta, allResults] = await Promise.all([
    fetchRace(raceId, fetchImpl),
    fetchAllResults(raceId, fetchImpl)
  ]);
  if (raceMeta.modeName !== 'Enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Enduro Breakdown currently works with section-based races."
    );
  }
  return { raceId, raceMeta, allResults };
}

export async function resolveAndLoadRace(input: unknown, fetchImpl?: FetchLike): Promise<NormalizedRace & { raceId: string | number }> {
  const parsed = parseRaceId(input);
  if (!parsed) {
    throw new UnparseableInputError(
      "Couldn't find a race ID in that — try pasting a LiveLaps race/results/event URL, or just the number."
    );
  }

  let raceId = parsed.id;
  if (parsed.isEvent) {
    const races = await fetchEventRaces(parsed.id, fetchImpl);
    if (races.length === 0) {
      throw new MultiRaceEventError('This event has no races yet.');
    }
    if (races.length > 1) {
      throw new MultiRaceEventError(
        "This event has multiple races — paste the link for the specific race's results instead."
      );
    }
    const onlyRace = races[0];
    if (!onlyRace) throw new MultiRaceEventError('This event has no races yet.');
    raceId = onlyRace.id;
  }

  return loadRaceById(raceId, fetchImpl);
}
