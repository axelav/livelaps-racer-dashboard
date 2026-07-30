import { UnsupportedFormatError } from '../../src/livelaps.js';
import { openDatabase } from '../archive/database.js';
import { createArchive } from '../archive/repository.js';
import { createSources } from '../sources/index.js';

const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';
export const ANEC_PROMOTER_ID = 3162;
export const ANEC_PROMOTER_LABEL = 'ANEC/NEPG';
const DEFAULT_SINCE_YEAR = 2020;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_DB_PATH = '/data/enduro.db';

function parseYear(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`${label} must be a four-digit year.`);
  }
  return year;
}

function parsePromoterId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer.`);
  return id;
}

export function parseBackfillArgs(argv = [], env = process.env) {
  let sinceYear = DEFAULT_SINCE_YEAR;
  let dbPath = env.ENDURO_DB_PATH ?? DEFAULT_DB_PATH;
  let positionalYear = null;
  const promoterIds = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--since-year') {
      index += 1;
      if (index >= argv.length) throw new Error('--since-year requires a year.');
      sinceYear = parseYear(argv[index], '--since-year');
    } else if (arg.startsWith('--since-year=')) {
      sinceYear = parseYear(arg.slice('--since-year='.length), '--since-year');
    } else if (arg === '--db') {
      index += 1;
      if (index >= argv.length) throw new Error('--db requires a SQLite path.');
      dbPath = argv[index];
    } else if (arg.startsWith('--db=')) {
      dbPath = arg.slice('--db='.length);
    } else if (arg === '--promoter-id') {
      index += 1;
      if (index >= argv.length) throw new Error('--promoter-id requires an id.');
      promoterIds.push(parsePromoterId(argv[index], '--promoter-id'));
    } else if (arg.startsWith('--promoter-id=')) {
      promoterIds.push(parsePromoterId(arg.slice('--promoter-id='.length), '--promoter-id'));
    } else if (/^\d{4}$/.test(arg) && positionalYear == null) {
      positionalYear = parseYear(arg, 'cutoff');
    } else {
      throw new Error(`Unknown LiveLaps backfill argument: ${arg}`);
    }
  }

  if (positionalYear != null) sinceYear = positionalYear;
  return {
    sinceYear,
    dbPath,
    delayMs: DEFAULT_DELAY_MS,
    promoters: promoterIds.length > 0
      ? promoterIds.map((id) => ({ id, label: String(id) }))
      : [{ id: ANEC_PROMOTER_ID, label: ANEC_PROMOTER_LABEL }]
  };
}

function cachedJsonResponse({ ok, status, text }) {
  return { ok, status, text: async () => text, json: async () => JSON.parse(text) };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCachedLiveLapsFetch({
  fetchImpl = globalThis.fetch,
  delayMs = DEFAULT_DELAY_MS,
  now = Date.now,
  wait = defaultWait
} = {}) {
  const cache = new Map();
  let lastUncachedRequestAt = null;
  let queue = Promise.resolve();

  return async function cachedFetch(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (cache.has(url)) return cachedJsonResponse(cache.get(url));

    const request = queue.then(async () => {
      if (cache.has(url)) return cachedJsonResponse(cache.get(url));

      if (lastUncachedRequestAt != null) {
        const elapsed = Number(now()) - lastUncachedRequestAt;
        const remaining = delayMs - elapsed;
        if (remaining > 0) await wait(remaining);
      }
      lastUncachedRequestAt = Number(now());

      const response = await fetchImpl(input, init);
      const text = typeof response.text === 'function'
        ? await response.text()
        : JSON.stringify(await response.json());
      const entry = { ok: response.ok, status: response.status, text };
      cache.set(url, entry);
      return cachedJsonResponse(entry);
    });

    queue = request.catch(() => {});
    return request;
  };
}

function parseDateOnly(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return Date.UTC(year, month - 1, day);
}

function currentDayUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function discoverLiveLapsPromoterEvents(
  events,
  { sinceYear = DEFAULT_SINCE_YEAR, currentDate = new Date() } = {}
) {
  const current = currentDayUtc(currentDate);
  return events
    .map((event) => {
      const eventDateMs = parseDateOnly(event.eventDate);
      const eventYear = eventDateMs == null ? Number(event.eventYear) : new Date(eventDateMs).getUTCFullYear();
      return { event, eventDateMs, eventYear };
    })
    .filter(({ event, eventDateMs, eventYear }) => {
      if (!Number.isInteger(eventYear) || eventYear < sinceYear) return false;
      if (eventDateMs == null || eventDateMs > current) return false;
      return Number(event.raceCount) > 0;
    })
    .map(({ event }) => ({
      eventId: String(event.id),
      eventName: event.name ?? '',
      eventDate: event.eventDate ?? null,
      promoterId: String(event.promoterUserId ?? ''),
      promoterName: event.promoterName ?? '',
      raceCount: Number(event.raceCount) || 0
    }));
}

async function fetchJsonMessage(fetchImpl, path, label) {
  const response = await fetchImpl(API_BASE + path);
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  const payload = await response.json();
  if (payload.success === 0) {
    const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    throw new Error(`${label} failed: ${message || 'not_found'}`);
  }
  return payload.message ?? [];
}

function sourceRaceKey(raceId) {
  return `livelaps:${raceId}`;
}

function raceUrl(raceId) {
  return `https://www.livelaps.com/livelaps/race/${raceId}`;
}

function failureFor(sourceRaceId, error) {
  return { sourceRaceId, error: error?.message ?? String(error) };
}

async function racesForEvent(event, fetchImpl) {
  const races = await fetchJsonMessage(fetchImpl, `race/event/${event.eventId}`, event.eventId);
  return races
    .filter((race) => race?.id != null)
    .map((race) => ({
      event,
      raceId: String(race.id),
      raceName: race.raceName ?? '',
      scoringStatus: race.scoring_status ?? null
    }));
}

export async function backfillLiveLapsArchive({
  archive,
  fetchImpl = globalThis.fetch,
  sinceYear = DEFAULT_SINCE_YEAR,
  currentDate = new Date(),
  delayMs = DEFAULT_DELAY_MS,
  capturedAt = () => new Date().toISOString(),
  promoters = [{ id: ANEC_PROMOTER_ID, label: ANEC_PROMOTER_LABEL }]
}) {
  const liveLapsFetch = createCachedLiveLapsFetch({ fetchImpl, delayMs });
  const sources = createSources({ fetchImpl: liveLapsFetch });
  const summary = {
    discoveredPromoters: promoters.length,
    discoveredEvents: 0,
    discoveredSourceRaces: 0,
    saved: 0,
    skipped: 0,
    skippedUnsupported: 0,
    failures: []
  };

  for (const promoter of promoters) {
    const eventRows = await fetchJsonMessage(liveLapsFetch, `promoter/${promoter.id}/events`, promoter.label);
    const events = discoverLiveLapsPromoterEvents(eventRows, { sinceYear, currentDate });
    summary.discoveredEvents += events.length;

    for (const event of events) {
      let races;
      try {
        races = await racesForEvent(event, liveLapsFetch);
      } catch (error) {
        summary.failures.push(failureFor(`event:${event.eventId}`, error));
        continue;
      }

      summary.discoveredSourceRaces += races.length;
      for (const race of races) {
        if (archive.getCurrentSnapshot(sourceRaceKey(race.raceId))) {
          summary.skipped += 1;
          continue;
        }

        try {
          const loaded = await sources.load(raceUrl(race.raceId));
          archive.saveSnapshot(loaded, capturedAt());
          summary.saved += 1;
        } catch (error) {
          if (error instanceof UnsupportedFormatError) {
            summary.skippedUnsupported += 1;
          } else {
            summary.failures.push(failureFor(race.raceId, error));
          }
        }
      }
    }
  }

  return summary;
}

function writeSummary(stream, summary) {
  stream.write(
    [
      'LiveLaps ANEC/NEPG archive backfill complete.',
      `Discovered promoters: ${summary.discoveredPromoters}`,
      `Discovered events: ${summary.discoveredEvents}`,
      `Discovered Source Races: ${summary.discoveredSourceRaces}`,
      `Saved: ${summary.saved}`,
      `Skipped existing: ${summary.skipped}`,
      `Skipped unsupported: ${summary.skippedUnsupported}`,
      `Failures: ${summary.failures.length}`
    ].join('\n') + '\n'
  );
  for (const failure of summary.failures) {
    stream.write(`- ${failure.sourceRaceId}: ${failure.error}\n`);
  }
}

export async function runLiveLapsBackfillCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch
} = {}) {
  let args;
  try {
    args = parseBackfillArgs(argv, env);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 2;
  }

  const db = openDatabase(args.dbPath);
  try {
    const summary = await backfillLiveLapsArchive({
      archive: createArchive(db),
      fetchImpl,
      sinceYear: args.sinceYear,
      delayMs: args.delayMs,
      promoters: args.promoters
    });
    writeSummary(summary.failures.length > 0 ? stderr : stdout, summary);
    return summary.failures.length > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}
