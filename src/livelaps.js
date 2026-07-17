const RACE_ID_PATTERNS = [/race\/results\/(\d+)/, /race\/filters\/(\d+)/, /race\/config\/(\d+)/, /race\/(\d+)/];
const EVENT_ID_PATTERN = /eventScores\/(\d+)/;

const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';

export class UnparseableInputError extends Error {}
export class MultiRaceEventError extends Error {}
export class UnsupportedFormatError extends Error {}

export function parseRaceId(input) {
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

export function parseDuration(value) {
  if (!value) return 0;
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function deriveTotals(allResults, participantId) {
  const racer = allResults.find((r) => r.id === participantId);
  if (!racer) return null;
  const classSize = allResults.filter((r) => r.className === racer.className).length;
  return { racer, fieldSize: allResults.length, classSize };
}

export function deriveSectionSeries(racer) {
  const sections = racer.sections;
  return {
    names: sections.map((s) => s.sectionName),
    cumTimes: sections.map((s) => s.totalCumulatedTime),
    cumulativeOverallPositions: sections.map((s) => s.overallPosition),
    cumulativeClassPositions: sections.map((s) => s.classPosition),
    sectionOnlyOverallRanks: sections.map((s) => s.sectionOverallPosition),
    sectionOnlyClassRanks: sections.map((s) => s.sectionClassPosition),
    avgSpeeds: sections.map((s) => parseFloat(s.avgSpeed)),
    gapAheadSeconds: sections.map((s) => parseDuration(s.overallBehindBy))
  };
}

async function apiGet(path) {
  const response = await fetch(API_BASE + path);
  if (!response.ok) {
    throw new Error(`LiveLaps API request failed: ${response.status} ${path}`);
  }
  return response.json();
}

export async function fetchRace(raceId) {
  const json = await apiGet(`race/${raceId}`);
  return { raceName: json.message.Race_Name, modeName: json.message.RACE_MODE_NAME };
}

export async function fetchAllResults(raceId) {
  let page = 1;
  let all = [];
  while (page <= 500) {
    const json = await apiGet(`race/results/${raceId}?page=${page}&size=1000`);
    all = all.concat(json.data);
    if (!json.has_more_pages || all.length >= json.total) break;
    page += 1;
  }
  return all;
}

export async function fetchEventRaces(eventId) {
  const json = await apiGet(`race/event/${eventId}`);
  return json.message;
}

export async function loadRaceById(raceId) {
  const [raceMeta, allResults] = await Promise.all([fetchRace(raceId), fetchAllResults(raceId)]);
  if (raceMeta.modeName !== 'Enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Enduro Breakdown currently works with section-based races."
    );
  }
  return { raceId, raceMeta, allResults };
}

export async function resolveAndLoadRace(input) {
  const parsed = parseRaceId(input);
  if (!parsed) {
    throw new UnparseableInputError(
      "Couldn't find a race ID in that — try pasting a LiveLaps race/results/event URL, or just the number."
    );
  }

  let raceId = parsed.id;
  if (parsed.isEvent) {
    const races = await fetchEventRaces(parsed.id);
    if (races.length === 0) {
      throw new MultiRaceEventError('This event has no races yet.');
    }
    if (races.length > 1) {
      throw new MultiRaceEventError(
        "This event has multiple races — paste the link for the specific race's results instead."
      );
    }
    raceId = races[0].id;
  }

  return loadRaceById(raceId);
}
