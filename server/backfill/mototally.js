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

function parseYear(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`${label} must be a four-digit year.`);
  }
  return year;
}

export function parseBackfillArgs(argv = [], env = process.env) {
  let sinceYear = DEFAULT_SINCE_YEAR;
  let dbPath = env.ENDURO_DB_PATH ?? DEFAULT_DB_PATH;
  let positionalYear = null;

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
    } else if (/^\d{4}$/.test(arg) && positionalYear == null) {
      positionalYear = parseYear(arg, 'cutoff');
    } else {
      throw new Error(`Unknown Moto-Tally backfill argument: ${arg}`);
    }
  }

  if (positionalYear != null) sinceYear = positionalYear;
  return { sinceYear, dbPath, delayMs: DEFAULT_DELAY_MS };
}

function cellText(cell) {
  return cell?.textContent.replace(/\u00a0/g, ' ').trim() ?? '';
}

function tableHasRaceHeader(row) {
  return Array.from(row.querySelectorAll('th, td')).some((cell) => /^race\s*#?$/i.test(cellText(cell)));
}

function eventFromRow(row, { sinceYear, currentYear }) {
  const link = Array.from(row.querySelectorAll('a')).find((a) => /\bRESULTS\b/i.test(cellText(a)));
  const match = link?.getAttribute('href')?.match(/selectEvent\((\d{4})\s*,\s*(\d+)\)/i);
  if (!match) return null;

  const [, year, round] = match;
  const numericYear = Number(year);
  if (numericYear < sinceYear || numericYear > currentYear) return null;
  return { org: ECEA_ENDURO_ORG, discipline: ECEA_ENDURO_DISCIPLINE, year, round };
}

export function discoverMotoTallyCalendarEvents(
  doc,
  { sinceYear = DEFAULT_SINCE_YEAR, currentYear = new Date().getUTCFullYear() } = {}
) {
  const events = [];
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

function cachedResponse({ ok, status, text }) {
  return { ok, status, text: async () => text };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCachedMotoTallyFetch({
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
    if (cache.has(url)) return cachedResponse(cache.get(url));

    const request = queue.then(async () => {
      if (cache.has(url)) return cachedResponse(cache.get(url));

      if (lastUncachedRequestAt != null) {
        const elapsed = Number(now()) - lastUncachedRequestAt;
        const remaining = delayMs - elapsed;
        if (remaining > 0) await wait(remaining);
      }
      lastUncachedRequestAt = Number(now());

      const response = await fetchImpl(input, init);
      const text = await response.text();
      const entry = { ok: response.ok, status: response.status, text };
      cache.set(url, entry);
      return cachedResponse(entry);
    });

    queue = request.catch(() => {});
    return request;
  };
}

function resultsUrl({ org, discipline, year, round, group }) {
  return `https://www.moto-tally.com/${org}/${discipline}/Results.aspx/${year}/${round}/${group}/CS`;
}

function sourceRaceId({ org, discipline, year, round, group }) {
  return `${org}/${discipline}/${year}/${round}/${group}`;
}

function sourceRaceKey(descriptor) {
  return `mototally:${sourceRaceId(descriptor)}`;
}

function parseResultDoc(html, parseHtml) {
  return parseHtml(sanitizeHtml(html));
}

function courseOverallOptions(doc) {
  const select = doc.querySelector('#mtR_ddlSelectClass');
  if (!select) return [];

  const overallOptions = Array.from(select.querySelectorAll('option'))
    .map((option) => ({
      value: option.getAttribute('value'),
      label: cellText(option).toLowerCase()
    }))
    .filter(({ value }) => /^O\d+$/.test(value ?? ''));
  const courseOptions = overallOptions
    .filter(({ label }) => !/^overall\s+[abc]$/i.test(label))
    .map(({ value }) => value);

  return courseOptions.length > 0
    ? courseOptions
    : overallOptions.map(({ value }) => value);
}

async function responseTextOrThrow(response, label) {
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  return response.text();
}

async function overallGroupsForEvent(event, { archive, fetchImpl, parseHtml }) {
  const o1Descriptor = { ...event, group: 'O1' };
  const existingO1 = archive.getCurrentSnapshot(sourceRaceKey(o1Descriptor));
  let doc;

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

function failureFor(descriptor, error) {
  return {
    sourceRaceId: sourceRaceId(descriptor),
    error: error?.message ?? String(error)
  };
}

export async function backfillMotoTallyArchive({
  archive,
  fetchImpl = globalThis.fetch,
  parseHtml = (html) => parseHTML(html).document,
  sinceYear = DEFAULT_SINCE_YEAR,
  currentYear = new Date().getUTCFullYear(),
  delayMs = DEFAULT_DELAY_MS,
  capturedAt = () => new Date().toISOString()
}) {
  const motoTallyFetch = createCachedMotoTallyFetch({ fetchImpl, delayMs });
  const calendarHtml = await responseTextOrThrow(
    await motoTallyFetch(ECEA_ENDURO_CALENDAR_URL),
    'ECEA Enduro calendar'
  );
  const calendarDoc = parseHtml(sanitizeHtml(calendarHtml));
  const events = discoverMotoTallyCalendarEvents(calendarDoc, { sinceYear, currentYear });
  const sources = createSources({ fetchImpl: motoTallyFetch, parseHtml });
  const summary = {
    discoveredEvents: events.length,
    discoveredSourceRaces: 0,
    saved: 0,
    skipped: 0,
    failures: []
  };

  for (const event of events) {
    let groups;
    try {
      groups = await overallGroupsForEvent(event, { archive, fetchImpl: motoTallyFetch, parseHtml });
    } catch (error) {
      summary.failures.push(failureFor({ ...event, group: 'O1' }, error));
      continue;
    }

    summary.discoveredSourceRaces += groups.length;
    for (const group of groups) {
      const descriptor = { ...event, group };
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

function writeSummary(stream, summary) {
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
  parseHtml = (html) => parseHTML(html).document
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
