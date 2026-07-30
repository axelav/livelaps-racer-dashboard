import type { LoadedRace } from '../../src/domain.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { sanitizeHtml } from '../../src/mototally.js';
import { openDatabase } from '../archive/database.js';
import { createArchive } from '../archive/repository.js';
import { createSources } from '../sources/index.js';

export const ECEA_ENDURO_ORG = 'ECEA';
export const ECEA_ENDURO_DISCIPLINE = 'Enduro';
export const ECEA_ENDURO_CALENDAR_URL = 'https://www.moto-tally.com/ECEA/Enduro/Results.aspx';
const DEFAULT_SINCE_YEAR = 2020;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_DB_PATH = '/data/enduro.db';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchImpl<TResponse> = (input: FetchInput, init?: FetchInit) => Promise<TResponse>;
type Clock = () => number;
type Wait = (ms: number) => Promise<unknown>;
type ParseHtml = (html: string) => Document;
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

export type MotoTallyBackfillArgs = {
  sinceYear: number;
  dbPath: string;
  delayMs: number;
};

type MotoTallyBackfillCliOptions = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdout?: OutputStream;
  stderr?: OutputStream;
  fetchImpl?: FetchImpl<TextFetchResponse>;
  parseHtml?: ParseHtml;
};

type MotoTallyCalendarEvent = {
  org: string;
  discipline: string;
  year: string;
  round: string;
};

type MotoTallyRaceDescriptor = MotoTallyCalendarEvent & {
  group: string;
};

type MotoTallyDiscoveryOptions = {
  sinceYear: number;
  currentYear: number;
};

type CachedTextEntry = {
  ok: boolean;
  status: number;
  text: string;
};

type TextFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type CachedTextResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type CachedMotoTallyFetchOptions = {
  fetchImpl?: FetchImpl<TextFetchResponse>;
  delayMs?: number;
  now?: Clock;
  wait?: Wait;
};

type CourseOption = {
  value: string | null;
  label: string;
};

type CourseOptionWithValue = {
  value: string;
  label: string;
};

type OverallGroupsOptions = {
  archive: ArchiveStore;
  fetchImpl: FetchImpl<TextFetchResponse>;
  parseHtml: ParseHtml;
};

type MotoTallyBackfillOptions = {
  archive: ArchiveStore;
  fetchImpl?: FetchImpl<TextFetchResponse>;
  parseHtml?: ParseHtml;
  sinceYear?: number;
  currentYear?: number;
  delayMs?: number;
  capturedAt?: CaptureTimestamp;
};

type BackfillFailure = {
  sourceRaceId: string;
  error: string;
};

export type MotoTallyBackfillSummary = {
  discoveredEvents: number;
  discoveredSourceRaces: number;
  saved: number;
  skipped: number;
  failures: BackfillFailure[];
};

const defaultParseHtml: ParseHtml = (html: string): Document => parseHTML(html).document;

function parseYear(value: string, label: string): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`${label} must be a four-digit year.`);
  }
  return year;
}

export function parseBackfillArgs(
  argv: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env
): MotoTallyBackfillArgs {
  let sinceYear = DEFAULT_SINCE_YEAR;
  let dbPath = env.ENDURO_DB_PATH ?? DEFAULT_DB_PATH;
  let positionalYear: number | null = null;

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
    } else if (/^\d{4}$/.test(arg) && positionalYear == null) {
      positionalYear = parseYear(arg, 'cutoff');
    } else {
      throw new Error(`Unknown Moto-Tally backfill argument: ${arg}`);
    }
  }

  if (positionalYear != null) sinceYear = positionalYear;
  return { sinceYear, dbPath, delayMs: DEFAULT_DELAY_MS };
}

function cellText(cell: Element | null | undefined): string {
  return cell?.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
}

function tableHasRaceHeader(row: Element): boolean {
  return Array.from(row.querySelectorAll('th, td')).some((cell) => /^race\s*#?$/i.test(cellText(cell)));
}

function eventFromRow(
  row: Element,
  { sinceYear, currentYear }: MotoTallyDiscoveryOptions
): MotoTallyCalendarEvent | null {
  const link = Array.from(row.querySelectorAll('a')).find((anchor) => /\bRESULTS\b/i.test(cellText(anchor)));
  const match = link?.getAttribute('href')?.match(/selectEvent\((\d{4})\s*,\s*(\d+)\)/i);
  if (!match) return null;

  const year = match[1]!;
  const round = match[2]!;
  const numericYear = Number(year);
  if (numericYear < sinceYear || numericYear > currentYear) return null;
  return { org: ECEA_ENDURO_ORG, discipline: ECEA_ENDURO_DISCIPLINE, year, round };
}

export function discoverMotoTallyCalendarEvents(
  doc: Document,
  { sinceYear = DEFAULT_SINCE_YEAR, currentYear = new Date().getUTCFullYear() }: Partial<MotoTallyDiscoveryOptions> = {}
): MotoTallyCalendarEvent[] {
  const events: MotoTallyCalendarEvent[] = [];
  for (const table of doc.querySelectorAll('table')) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const headerIndex = rows.findIndex(tableHasRaceHeader);
    if (headerIndex < 0) continue;

    for (const row of rows.slice(headerIndex + 1)) {
      const event = eventFromRow(row, { sinceYear, currentYear });
      if (event) events.push(event);
    }
  }
  return events;
}

function cachedResponse({ ok, status, text }: CachedTextEntry): CachedTextResponse {
  return { ok, status, text: async () => text };
}

function defaultWait(ms: number): Promise<unknown> {
  return sleep(ms);
}

function cacheKey(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function createCachedMotoTallyFetch({
  fetchImpl = globalThis.fetch,
  delayMs = DEFAULT_DELAY_MS,
  now = Date.now,
  wait = defaultWait
}: CachedMotoTallyFetchOptions = {}): FetchImpl<CachedTextResponse> {
  const cache = new Map<string, CachedTextEntry>();
  let lastUncachedRequestAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  return async function cachedFetch(input: FetchInput, init?: FetchInit): Promise<CachedTextResponse> {
    const url = cacheKey(input);
    const cached = cache.get(url);
    if (cached) return cachedResponse(cached);

    const request = queue.then(async (): Promise<CachedTextResponse> => {
      const queuedCached = cache.get(url);
      if (queuedCached) return cachedResponse(queuedCached);

      if (lastUncachedRequestAt != null) {
        const elapsed = Number(now()) - lastUncachedRequestAt;
        const remaining = delayMs - elapsed;
        if (remaining > 0) await wait(remaining);
      }
      lastUncachedRequestAt = Number(now());

      const response = await fetchImpl(input, init);
      const text = await response.text();
      const entry: CachedTextEntry = { ok: response.ok, status: response.status, text };
      cache.set(url, entry);
      return cachedResponse(entry);
    });

    queue = request.catch(() => {});
    return request;
  };
}

function resultsUrl({ org, discipline, year, round, group }: MotoTallyRaceDescriptor): string {
  return `https://www.moto-tally.com/${org}/${discipline}/Results.aspx/${year}/${round}/${group}/CS`;
}

function sourceRaceId({ org, discipline, year, round, group }: MotoTallyRaceDescriptor): string {
  return `${org}/${discipline}/${year}/${round}/${group}`;
}

function sourceRaceKey(descriptor: MotoTallyRaceDescriptor): string {
  return `mototally:${sourceRaceId(descriptor)}`;
}

function parseResultDoc(html: string, parseHtml: ParseHtml): Document {
  return parseHtml(sanitizeHtml(html));
}

function courseOverallOptions(doc: Document): string[] {
  const select = doc.querySelector('#mtR_ddlSelectClass');
  if (!select) return [];

  const overallOptions = Array.from(select.querySelectorAll('option'))
    .map((option): CourseOption => ({
      value: option.getAttribute('value'),
      label: cellText(option).toLowerCase()
    }))
    .filter((option): option is CourseOptionWithValue => /^O\d+$/.test(option.value ?? ''));
  const courseOptions = overallOptions
    .filter(({ label }) => !/^overall\s+[abc]$/i.test(label))
    .map(({ value }) => value);

  return courseOptions.length > 0
    ? courseOptions
    : overallOptions.map(({ value }) => value);
}

async function responseTextOrThrow(response: TextFetchResponse, label: string): Promise<string> {
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  return response.text();
}

async function overallGroupsForEvent(
  event: MotoTallyCalendarEvent,
  { archive, fetchImpl, parseHtml }: OverallGroupsOptions
): Promise<string[]> {
  const o1Descriptor: MotoTallyRaceDescriptor = { ...event, group: 'O1' };
  const existingO1 = archive.getCurrentSnapshot(sourceRaceKey(o1Descriptor));
  let doc: Document;

  if (existingO1) {
    doc = parseResultDoc(existingO1.artifact.text, parseHtml);
  } else {
    const html = await responseTextOrThrow(
      await fetchImpl(resultsUrl(o1Descriptor)),
      sourceRaceId(o1Descriptor)
    );
    doc = parseResultDoc(html, parseHtml);
  }

  const groups = courseOverallOptions(doc);
  return groups.length > 0 ? groups : ['O1'];
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    return message == null ? String(error) : String(message);
  }
  return String(error);
}

function failureFor(descriptor: MotoTallyRaceDescriptor, error: unknown): BackfillFailure {
  return {
    sourceRaceId: sourceRaceId(descriptor),
    error: errorMessage(error)
  };
}

export async function backfillMotoTallyArchive({
  archive,
  fetchImpl = globalThis.fetch,
  parseHtml = defaultParseHtml,
  sinceYear = DEFAULT_SINCE_YEAR,
  currentYear = new Date().getUTCFullYear(),
  delayMs = DEFAULT_DELAY_MS,
  capturedAt = () => new Date().toISOString()
}: MotoTallyBackfillOptions): Promise<MotoTallyBackfillSummary> {
  const motoTallyFetch = createCachedMotoTallyFetch({ fetchImpl, delayMs });
  const calendarHtml = await responseTextOrThrow(
    await motoTallyFetch(ECEA_ENDURO_CALENDAR_URL),
    'ECEA Enduro calendar'
  );
  const calendarDoc = parseHtml(sanitizeHtml(calendarHtml));
  const events = discoverMotoTallyCalendarEvents(calendarDoc, { sinceYear, currentYear });
  const sources = createSources({ fetchImpl: motoTallyFetch, parseHtml }) as SourceLoader;
  const summary: MotoTallyBackfillSummary = {
    discoveredEvents: events.length,
    discoveredSourceRaces: 0,
    saved: 0,
    skipped: 0,
    failures: []
  };

  for (const event of events) {
    let groups: string[];
    try {
      groups = await overallGroupsForEvent(event, { archive, fetchImpl: motoTallyFetch, parseHtml });
    } catch (error) {
      summary.failures.push(failureFor({ ...event, group: 'O1' }, error));
      continue;
    }

    summary.discoveredSourceRaces += groups.length;
    for (const group of groups) {
      const descriptor: MotoTallyRaceDescriptor = { ...event, group };
      if (archive.getCurrentSnapshot(sourceRaceKey(descriptor))) {
        summary.skipped += 1;
        continue;
      }

      try {
        const loaded = await sources.load(resultsUrl(descriptor));
        archive.saveSnapshot(loaded, capturedAt());
        summary.saved += 1;
      } catch (error) {
        summary.failures.push(failureFor(descriptor, error));
      }
    }
  }

  return summary;
}

function writeSummary(stream: OutputStream, summary: MotoTallyBackfillSummary): void {
  stream.write(
    [
      `Moto-Tally archive backfill complete.`,
      `Discovered events: ${summary.discoveredEvents}`,
      `Discovered Source Races: ${summary.discoveredSourceRaces}`,
      `Saved: ${summary.saved}`,
      `Skipped existing: ${summary.skipped}`,
      `Failures: ${summary.failures.length}`
    ].join('\n') + '\n'
  );
  for (const failure of summary.failures) {
    stream.write(`- ${failure.sourceRaceId}: ${failure.error}\n`);
  }
}

export async function runMotoTallyBackfillCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch,
  parseHtml = defaultParseHtml
}: MotoTallyBackfillCliOptions = {}): Promise<number> {
  let args: MotoTallyBackfillArgs;
  try {
    args = parseBackfillArgs(argv, env);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 2;
  }

  const db = openDatabase(args.dbPath);
  try {
    const summary = await backfillMotoTallyArchive({
      archive: createArchive(db),
      fetchImpl,
      parseHtml,
      sinceYear: args.sinceYear,
      delayMs: args.delayMs
    });
    writeSummary(summary.failures.length > 0 ? stderr : stdout, summary);
    return summary.failures.length > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}
