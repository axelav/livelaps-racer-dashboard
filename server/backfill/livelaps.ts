import type { LoadedRace } from '../../src/domain.js';
import { setTimeout as sleep } from 'node:timers/promises';
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

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchImpl<TResponse> = (input: FetchInput, init?: FetchInit) => Promise<TResponse>;
type Clock = () => number;
type Wait = (ms: number) => Promise<unknown>;
type OutputStream = { write(chunk: string): unknown };
type CaptureTimestamp = () => string;

type ArchiveSnapshot = {
  artifact: {
    text: string;
  };
};

type ArchiveStore = {
  getCurrentSnapshot(key: string): ArchiveSnapshot | null | undefined;
  saveSnapshot(loaded: LoadedRace, capturedAt: string): unknown;
};

type SourceLoader = {
  load(input: string): Promise<LoadedRace>;
};

type LiveLapsPromoter = {
  id: number;
  label: string;
};

export type LiveLapsBackfillArgs = {
  sinceYear: number;
  dbPath: string;
  delayMs: number;
  promoters: LiveLapsPromoter[];
};

type LiveLapsBackfillCliOptions = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdout?: OutputStream;
  stderr?: OutputStream;
  fetchImpl?: FetchImpl<LiveLapsJsonResponse>;
};

type CachedJsonEntry = {
  ok: boolean;
  status: number;
  text: string;
};

type LiveLapsJsonResponse = {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
  json: () => Promise<unknown>;
};

type CachedJsonResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

type CachedLiveLapsFetchOptions = {
  fetchImpl?: FetchImpl<LiveLapsJsonResponse>;
  delayMs?: number;
  now?: Clock;
  wait?: Wait;
};

type LiveLapsPromoterEventRow = {
  id?: unknown;
  name?: string | null;
  eventDate?: string | null;
  eventYear?: string | number | null;
  promoterUserId?: string | number | null;
  promoterName?: string | null;
  raceCount?: string | number | null;
};

type LiveLapsPromoterEvent = {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  promoterId: string;
  promoterName: string;
  raceCount: number;
};

type LiveLapsRaceRow = {
  id?: string | number | null;
  raceName?: string | null;
  scoring_status?: string | null;
};

type LiveLapsRaceDescriptor = {
  event: LiveLapsPromoterEvent;
  raceId: string;
  raceName: string;
  scoringStatus: string | null;
};

type LiveLapsDiscoveryOptions = {
  sinceYear?: number;
  currentDate?: Date | string | number;
};

type LiveLapsBackfillOptions = {
  archive: ArchiveStore;
  fetchImpl?: FetchImpl<LiveLapsJsonResponse>;
  sinceYear?: number;
  currentDate?: Date | string | number;
  delayMs?: number;
  capturedAt?: CaptureTimestamp;
  promoters?: LiveLapsPromoter[];
};

type BackfillFailure = {
  sourceRaceId: string;
  error: string;
};

export type LiveLapsBackfillSummary = {
  discoveredPromoters: number;
  discoveredEvents: number;
  discoveredSourceRaces: number;
  saved: number;
  skipped: number;
  skippedUnsupported: number;
  failures: BackfillFailure[];
};

type LiveLapsApiPayload = {
  success?: unknown;
  message?: unknown;
};

function parseYear(value: string, label: string): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`${label} must be a four-digit year.`);
  }
  return year;
}

function parsePromoterId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer.`);
  return id;
}

export function parseBackfillArgs(
  argv: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env
): LiveLapsBackfillArgs {
  let sinceYear = DEFAULT_SINCE_YEAR;
  let dbPath = env.ENDURO_DB_PATH ?? DEFAULT_DB_PATH;
  let positionalYear: number | null = null;
  const promoterIds: number[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') {
      continue;
    } else if (arg === '--since-year') {
      index += 1;
      if (index >= argv.length) throw new Error('--since-year requires a year.');
      sinceYear = parseYear(argv[index]!, '--since-year');
    } else if (arg.startsWith('--since-year=')) {
      sinceYear = parseYear(arg.slice('--since-year='.length), '--since-year');
    } else if (arg === '--db') {
      index += 1;
      if (index >= argv.length) throw new Error('--db requires a SQLite path.');
      dbPath = argv[index]!;
    } else if (arg.startsWith('--db=')) {
      dbPath = arg.slice('--db='.length);
    } else if (arg === '--promoter-id') {
      index += 1;
      if (index >= argv.length) throw new Error('--promoter-id requires an id.');
      promoterIds.push(parsePromoterId(argv[index]!, '--promoter-id'));
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
      ? promoterIds.map((id): LiveLapsPromoter => ({ id, label: String(id) }))
      : [{ id: ANEC_PROMOTER_ID, label: ANEC_PROMOTER_LABEL }]
  };
}

function cachedJsonResponse({ ok, status, text }: CachedJsonEntry): CachedJsonResponse {
  return { ok, status, text: async () => text, json: async () => JSON.parse(text) };
}

function defaultWait(ms: number): Promise<unknown> {
  return sleep(ms);
}

function cacheKey(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function createCachedLiveLapsFetch({
  fetchImpl = globalThis.fetch,
  delayMs = DEFAULT_DELAY_MS,
  now = Date.now,
  wait = defaultWait
}: CachedLiveLapsFetchOptions = {}): FetchImpl<CachedJsonResponse> {
  const cache = new Map<string, CachedJsonEntry>();
  let lastUncachedRequestAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  return async function cachedFetch(input: FetchInput, init?: FetchInit): Promise<CachedJsonResponse> {
    const url = cacheKey(input);
    const cached = cache.get(url);
    if (cached) return cachedJsonResponse(cached);

    const request = queue.then(async (): Promise<CachedJsonResponse> => {
      const queuedCached = cache.get(url);
      if (queuedCached) return cachedJsonResponse(queuedCached);

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
      const entry: CachedJsonEntry = { ok: response.ok, status: response.status, text };
      cache.set(url, entry);
      return cachedJsonResponse(entry);
    });

    queue = request.catch(() => {});
    return request;
  };
}

function parseDateOnly(value: unknown): number | null {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Date.UTC(year, month - 1, day);
}

function currentDayUtc(value: Date | string | number): number {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function discoverLiveLapsPromoterEvents(
  events: readonly LiveLapsPromoterEventRow[],
  { sinceYear = DEFAULT_SINCE_YEAR, currentDate = new Date() }: LiveLapsDiscoveryOptions = {}
): LiveLapsPromoterEvent[] {
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

async function fetchJsonMessage<T>(
  fetchImpl: FetchImpl<LiveLapsJsonResponse>,
  path: string,
  label: string
): Promise<T[]> {
  const response = await fetchImpl(API_BASE + path);
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  const payload = await response.json() as LiveLapsApiPayload;
  if (payload.success === 0) {
    const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    throw new Error(`${label} failed: ${message || 'not_found'}`);
  }
  return (payload.message ?? []) as T[];
}

function sourceRaceKey(raceId: string): string {
  return `livelaps:${raceId}`;
}

function raceUrl(raceId: string): string {
  return `https://www.livelaps.com/livelaps/race/${raceId}`;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    return message == null ? String(error) : String(message);
  }
  return String(error);
}

function failureFor(sourceRaceId: string, error: unknown): BackfillFailure {
  return { sourceRaceId, error: errorMessage(error) };
}

async function racesForEvent(
  event: LiveLapsPromoterEvent,
  fetchImpl: FetchImpl<LiveLapsJsonResponse>
): Promise<LiveLapsRaceDescriptor[]> {
  const races = await fetchJsonMessage<LiveLapsRaceRow>(fetchImpl, `race/event/${event.eventId}`, event.eventId);
  return races
    .filter((race) => race?.id != null)
    .map((race): LiveLapsRaceDescriptor => ({
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
}: LiveLapsBackfillOptions): Promise<LiveLapsBackfillSummary> {
  const liveLapsFetch = createCachedLiveLapsFetch({ fetchImpl, delayMs });
  const sources = createSources({ fetchImpl: liveLapsFetch }) as SourceLoader;
  const summary: LiveLapsBackfillSummary = {
    discoveredPromoters: promoters.length,
    discoveredEvents: 0,
    discoveredSourceRaces: 0,
    saved: 0,
    skipped: 0,
    skippedUnsupported: 0,
    failures: []
  };

  for (const promoter of promoters) {
    const eventRows = await fetchJsonMessage<LiveLapsPromoterEventRow>(
      liveLapsFetch,
      `promoter/${promoter.id}/events`,
      promoter.label
    );
    const events = discoverLiveLapsPromoterEvents(eventRows, { sinceYear, currentDate });
    summary.discoveredEvents += events.length;

    for (const event of events) {
      let races: LiveLapsRaceDescriptor[];
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

function writeSummary(stream: OutputStream, summary: LiveLapsBackfillSummary): void {
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
}: LiveLapsBackfillCliOptions = {}): Promise<number> {
  let args: LiveLapsBackfillArgs;
  try {
    args = parseBackfillArgs(argv, env);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
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
