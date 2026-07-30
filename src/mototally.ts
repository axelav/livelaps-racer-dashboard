import { UnsupportedFormatError, UnparseableInputError } from './livelaps.js';
import { parseClock, formatHMS } from './time.js';
import type { NormalizedRace, PointsSection, RaceEntry, RaceMeta, TimedSection } from './domain.js';

const URL_PATTERN =
  /moto-tally\.com\/([^/]+)\/([^/]+)\/Results\.aspx\/(\d+)\/(\d+)\/([OC]\d+)\/([A-Za-z]+)/i;

const FIXED_COLS = 8; // EventPlace, AMA#, Row, Name, Club, Sponsors, Brand, Class
const TRAILING_COLS = 2; // MaxChk, TotalTime
const POINTS_TOTAL_PATTERN = /^(\d+)\/(\d+)$/;
export const PROXY_PREFIX = '/proxy/mototally/';

type FetchLike = typeof fetch;
type ParseHtml = (html: string) => Document;

type CalendarMetadata = {
  eventDate: string | null;
  location: string | null;
  organizer: string | null;
};

export type MotoTallyDescriptor = {
  org: string;
  discipline: string;
  year: string;
  round: string;
  group: string;
};

export type MotoTallyUrlDescriptor = MotoTallyDescriptor & {
  view: string;
};

type GroupSummary = {
  group: string;
  amaSet: Set<string>;
};

export type TimedCheck = {
  seconds: number | null;
  publishedPlace: number;
};

export type PointsCell = {
  points: number;
  seconds: number | null;
  publishedPlace: number | null;
};

export type RawTimedRecord = {
  id: number;
  fullName: string;
  displayedNumber: string;
  brand: string;
  className: string;
  overallPosition: number;
  totalTimeSeconds: number | null;
  sectionTimes: (TimedCheck | null)[];
};

export type RawPointsRecord = {
  id: number;
  fullName: string;
  displayedNumber: string;
  brand: string;
  className: string;
  overallPosition: number;
  scoring: 'points';
  maxChk: number;
  totalPoints: number | null;
  totalEmergencySeconds: number | null;
  checks: (PointsCell | null)[];
};

export type RawRecord = RawTimedRecord | RawPointsRecord;

type Score = {
  completed: number;
  points: number;
  seconds: number;
};

type PointsRaceEntry = RaceEntry & {
  id: number;
  fullName: string;
  displayedNumber: string;
  brand: string;
  className: string;
  overallPosition: number;
  classPosition: number;
  scoring: 'points';
  maxChk: number;
  checkCount: number;
  timedCheckCount: number;
  totalPoints: number | null;
  totalEmergencySeconds: number | null;
  pointsBehindOverallLeader: number;
  pointsBehindClassLeader: number;
  avgSpeedTotal: null;
  sections: PointsSection[];
};

type TimedRaceEntry = RaceEntry & {
  id: number;
  fullName: string;
  displayedNumber: string;
  brand: string;
  className: string;
  overallPosition: number;
  classPosition: number;
  avgSpeedTotal: null;
  overallBehindByLeader: string | null;
  classBehindByLeader: string | null;
  sections: TimedSection[];
};

function text(node: Node | null | undefined): string {
  return node?.textContent ?? '';
}

function requireAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Malformed Moto-Tally results table.');
  return item;
}

export function isMotoTallyUrl(input: unknown): input is string {
  return typeof input === 'string' && /moto-tally\.com/i.test(input);
}

export function parseMotoTallyUrl(input: unknown): MotoTallyUrlDescriptor {
  const match = typeof input === 'string' ? input.match(URL_PATTERN) : null;
  if (!match) {
    throw new UnparseableInputError(
      "Couldn't read that Moto-Tally link — copy the full results page URL and try again."
    );
  }
  const [, org, discipline, year, round, group, view] = match;
  if (!org || !discipline || !year || !round || !group || !view) {
    throw new UnparseableInputError(
      "Couldn't read that Moto-Tally link — copy the full results page URL and try again."
    );
  }
  if (discipline.toLowerCase() !== 'enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Enduro Breakdown currently works with section-based races."
    );
  }
  return { org, discipline, year, round, group, view };
}

// Moto-Tally ships brand cells like `<span class='bb Beta'>BET</span` (no closing
// `>`). Browsers swallow the following `</td>` during error recovery, merging the
// rest of the row into the brand cell. Close the span before parsing.
export function sanitizeHtml(html: string): string {
  return html.replace(/<\/span(?=<)/gi, '</span>');
}

function dataRows(doc: Document): HTMLTableRowElement[] {
  const table = doc.querySelector('#mtR_gvResults');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).filter((tr) => {
    const first = tr.querySelector('td');
    return first !== null && /^\d+$/.test(text(first).trim());
  });
}

function cellsOf(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(tr.querySelectorAll('td'));
}

// A check cell is "M:SS (place)" when timed, or "0"/blank when an untimed checkpoint.
function parseCheckCell(td: HTMLTableCellElement): TimedCheck | null {
  const cellText = text(td).replace(/ /g, ' ').trim();
  const m = cellText.match(/^(\d+:\d{2})\s*\((\d+)\)$/);
  if (!m) return null;
  return { seconds: parseClock(m[1]), publishedPlace: Number(m[2]) };
}

// Points-format check cells: "7" (route check, points dropped), "11/656 (53)"
// (emergency check: points/seconds and published place), blank (never reached).
function parsePointsCell(td: HTMLTableCellElement): PointsCell | null {
  const cellText = text(td).replace(/\u00a0/g, ' ').trim();
  if (/^\d+$/.test(cellText)) return { points: Number(cellText), seconds: null, publishedPlace: null };
  const m = cellText.match(/^(\d+)\/(\d+)\s*\((\d+)\)$/);
  if (!m) return null;
  return { points: Number(m[1]), seconds: Number(m[2]), publishedPlace: Number(m[3]) };
}

export function parseRaceName(doc: Document): string {
  return text(doc.querySelector('#mtR_h1RREventName')).trim();
}

function calendarDate(value: string): string | null {
  const dateText = value.trim();
  const numeric = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    const [, month, day, year] = numeric;
    if (!month || !day || !year) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.valueOf())) return null;
  return [parsed.getUTCFullYear(), String(parsed.getUTCMonth() + 1).padStart(2, '0'), String(parsed.getUTCDate()).padStart(2, '0')].join('-');
}

function calendarValue(cells: readonly HTMLTableCellElement[], column: number): string | null {
  const value = text(cells[column]).replace(/ /g, ' ').trim();
  return value || null;
}

export function parseCalendarMetadata(doc: Document, descriptor: MotoTallyDescriptor): CalendarMetadata {
  for (const table of doc.querySelectorAll('table')) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const headerIndex = rows.findIndex((row) =>
      Array.from(row.querySelectorAll('th, td')).some((cell) =>
        /^race\s*#?$/i.test(text(cell).trim())
      )
    );
    if (headerIndex < 0) continue;

    const headerRow = requireAt(rows, headerIndex);
    const headers = Array.from(headerRow.querySelectorAll('th, td')).map((cell) =>
      text(cell).replace(/ /g, ' ').trim().toLowerCase()
    );
    const raceColumn = headers.findIndex((header) => /^race\s*#?$/.test(header));
    const dateColumn = headers.findIndex((header) => header === 'date');
    const locationColumn = headers.findIndex((header) => /^(location|city|venue)$/.test(header));
    const clubColumn = headers.findIndex((header) => /^(club|organizer|organization)$/.test(header));
    if (raceColumn < 0 || dateColumn < 0) continue;

    for (const row of rows.slice(headerIndex + 1)) {
      const cells = Array.from(row.querySelectorAll('td'));
      const round = calendarValue(cells, raceColumn)?.match(/\d+/)?.[0];
      const eventDate = calendarDate(calendarValue(cells, dateColumn) ?? '');
      if (round !== String(descriptor.round) || eventDate?.slice(0, 4) !== String(descriptor.year)) continue;

      return {
        eventDate,
        location: locationColumn < 0 ? null : calendarValue(cells, locationColumn),
        organizer: clubColumn < 0 ? null : calendarValue(cells, clubColumn)
      };
    }
  }

  return { eventDate: null, location: null, organizer: null };
}

// Moto-Tally events can split into disjoint courses (e.g. O1 "OVERALL Long
// Course" and O5 "Overall Short"), each its own competition under the same
// event name. Suffix the course label so archived races stay distinguishable.
export function raceDisplayName(doc: Document, group: string): string {
  const base = parseRaceName(doc);
  if (!/^O\d+$/.test(group ?? '') || parseOverallOptions(doc).length < 2) return base;
  const option = doc.querySelector(`#mtR_ddlSelectClass option[value="${group}"]`);
  const label = text(option).replace(/overall/i, '').trim();
  return label ? `${base} — ${label}` : base;
}

export function parseOverallOptions(doc: Document): string[] {
  const select = doc.querySelector('#mtR_ddlSelectClass');
  if (!select) return [];
  return Array.from(select.querySelectorAll('option'))
    .map((o) => o.getAttribute('value'))
    .filter((v): v is string => v !== null && /^O\d+$/.test(v));
}

export function parseAmaSet(doc: Document): Set<string> {
  return new Set(dataRows(doc).map((tr) => text(cellsOf(tr)[1]).trim()));
}

export function pickContainingGroup(summaries: readonly GroupSummary[], classAmaSet: ReadonlySet<string>): GroupSummary | null {
  const containing = summaries.filter((s) =>
    [...classAmaSet].every((ama) => s.amaSet.has(ama))
  );
  if (containing.length === 0) return null;
  return containing.reduce((best, s) => (s.amaSet.size > best.amaSet.size ? s : best));
}

function parseResultsPoints(rows: readonly HTMLTableRowElement[]): RawPointsRecord[] {
  return rows.map((tr) => {
    const cells = cellsOf(tr);
    const checkEnd = cells.length - TRAILING_COLS; // exclusive
    const checks: (PointsCell | null)[] = [];
    for (let c = FIXED_COLS; c < checkEnd; c++) checks.push(parsePointsCell(requireAt(cells, c)));
    const totalMatch = text(requireAt(cells, cells.length - 1)).trim().match(POINTS_TOTAL_PATTERN);
    const brandCell = requireAt(cells, 6);
    return {
      id: Number(text(requireAt(cells, 1)).trim()),
      fullName: text(requireAt(cells, 3)).trim(),
      displayedNumber: text(requireAt(cells, 2)).trim(),
      brand: (text(brandCell.querySelector('span')) || text(brandCell)).replace(/<.*$/s, '').trim(),
      className: text(requireAt(cells, 7)).trim(),
      overallPosition: Number(text(requireAt(cells, 0)).trim()),
      scoring: 'points',
      maxChk: Number(text(requireAt(cells, cells.length - 2)).trim()),
      totalPoints: totalMatch ? Number(totalMatch[1]) : null,
      totalEmergencySeconds: totalMatch ? Number(totalMatch[2]) : null,
      checks
    };
  });
}

export function parseResults(doc: Document): RawRecord[] {
  const rows = dataRows(doc);
  if (rows.length === 0) return [];

  const winnerCells = cellsOf(requireAt(rows, 0));

  // Timekeeping enduros total "points/emergency seconds" (e.g. "25/599");
  // sprint enduros total a clock time (e.g. "5:00").
  if (POINTS_TOTAL_PATTERN.test(text(requireAt(winnerCells, winnerCells.length - 1)).trim())) {
    return parseResultsPoints(rows);
  }

  // Timed columns = check columns where the winner (first data row) has a time.
  const checkStart = FIXED_COLS;
  const checkEnd = winnerCells.length - TRAILING_COLS; // exclusive
  const timedCols: number[] = [];
  for (let c = checkStart; c < checkEnd; c++) {
    if (parseCheckCell(requireAt(winnerCells, c)) !== null) timedCols.push(c);
  }

  return rows.map((tr) => {
    const cells = cellsOf(tr);
    const sectionTimes = timedCols.map((c) => parseCheckCell(requireAt(cells, c))); // null = DNF at that section
    const brandCell = requireAt(cells, 6);
    return {
      id: Number(text(requireAt(cells, 1)).trim()),
      fullName: text(requireAt(cells, 3)).trim(),
      displayedNumber: text(requireAt(cells, 2)).trim(),
      brand: (text(brandCell.querySelector('span')) || text(brandCell)).replace(/<.*$/s, '').trim(),
      className: text(requireAt(cells, 7)).trim(),
      overallPosition: Number(text(requireAt(cells, 0)).trim()),
      totalTimeSeconds: parseClock(text(requireAt(cells, cells.length - 1))),
      sectionTimes
    };
  });
}

// Official timekeeping-enduro ordering (validated against published ECEA
// results): most checks completed, then fewest points, then fewest emergency
// seconds.
function betterScore(a: Score, b: Score): boolean {
  if (a.completed !== b.completed) return a.completed > b.completed;
  if (a.points !== b.points) return a.points < b.points;
  return a.seconds < b.seconds;
}

function deriveStandingsPoints(rawRecords: readonly RawPointsRecord[]): PointsRaceEntry[] {
  const n = rawRecords.length;
  const checkCount = rawRecords[0]?.checks.length ?? 0;
  if (checkCount === 0) return [];

  // Per rider, per check: checks reached, cumulative points, cumulative emergency seconds.
  const cum: Score[][] = rawRecords.map((r) => {
    const out: Score[] = [];
    let completed = 0;
    let points = 0;
    let seconds = 0;
    for (let i = 0; i < checkCount; i++) {
      const c = r.checks[i];
      if (c != null) {
        completed += 1;
        points += c.points;
        if (c.seconds != null) seconds += c.seconds;
      }
      out.push({ completed, points, seconds });
    }
    return out;
  });

  // A check is "timed" (emergency check) if any rider has seconds recorded there.
  const timedCheck = Array.from({ length: checkCount }, (_, si) =>
    rawRecords.some((r) => r.checks[si]?.seconds != null)
  );

  const positionAt = (si: number, ri: number, sameClass: boolean): number => {
    const current = requireAt(rawRecords, ri);
    const me = requireAt(requireAt(cum, ri), si);
    let pos = 1;
    for (const [j, otherRecord] of rawRecords.entries()) {
      if (j === ri) continue;
      if (sameClass && otherRecord.className !== current.className) continue;
      if (betterScore(requireAt(requireAt(cum, j), si), me)) pos++;
    }
    return pos;
  };

  // Rank on this check's score alone: points, tie-broken by seconds where the
  // check is timed. At emergency checks this reproduces the published place; at
  // route checks whole-minute scores tie, and tied riders share the best rank
  // (competition ranking).
  const checkAloneRank = (si: number, ri: number, sameClass: boolean): number | null => {
    const current = requireAt(rawRecords, ri);
    const mine = current.checks[si];
    if (mine == null) return null;
    let pos = 1;
    for (const [j, otherRecord] of rawRecords.entries()) {
      if (j === ri) continue;
      if (sameClass && otherRecord.className !== current.className) continue;
      const other = otherRecord.checks[si];
      if (other == null) continue;
      if (
        other.points < mine.points ||
        (other.points === mine.points && (other.seconds ?? 0) < (mine.seconds ?? 0))
      ) {
        pos++;
      }
    }
    return pos;
  };

  const last = checkCount - 1;

  // Final class position: same comparator, but exact dead heats (possible —
  // the published tiebreak comes from the rulebook, not the table) defer to
  // the published overall place.
  const finalClassPosition = (ri: number): number => {
    const current = requireAt(rawRecords, ri);
    const me = requireAt(requireAt(cum, ri), last);
    let pos = 1;
    for (const [j, otherRecord] of rawRecords.entries()) {
      if (j === ri) continue;
      if (otherRecord.className !== current.className) continue;
      const other = requireAt(requireAt(cum, j), last);
      const tie =
        other.completed === me.completed && other.points === me.points && other.seconds === me.seconds;
      if (betterScore(other, me) || (tie && otherRecord.overallPosition < current.overallPosition)) {
        pos++;
      }
    }
    return pos;
  };

  let overallLeader = requireAt(requireAt(cum, 0), last);
  for (let j = 1; j < n; j++) {
    const candidate = requireAt(requireAt(cum, j), last);
    if (betterScore(candidate, overallLeader)) overallLeader = candidate;
  }
  const classLeaders = new Map<string, Score>();
  rawRecords.forEach((r, ri) => {
    const current = requireAt(requireAt(cum, ri), last);
    const best = classLeaders.get(r.className);
    if (!best || betterScore(current, best)) classLeaders.set(r.className, current);
  });

  return rawRecords.map((r, ri) => {
    const sections: PointsSection[] = r.checks.map((c, si) => ({
      sectionName: `Check ${si + 1}`,
      timed: timedCheck[si] ?? false,
      points: c?.points ?? null,
      seconds: c?.seconds ?? null,
      publishedPlace: c?.publishedPlace ?? null,
      sectionOverallPosition: checkAloneRank(si, ri, false),
      sectionClassPosition: checkAloneRank(si, ri, true),
      cumPoints: requireAt(requireAt(cum, ri), si).points,
      cumSeconds: requireAt(requireAt(cum, ri), si).seconds,
      overallPosition: positionAt(si, ri, false),
      classPosition: positionAt(si, ri, true)
    }));
    const classLeader = classLeaders.get(r.className);
    if (!classLeader) throw new Error('Malformed Moto-Tally class standings.');

    return {
      id: r.id,
      fullName: r.fullName,
      displayedNumber: r.displayedNumber,
      brand: r.brand,
      className: r.className,
      overallPosition: r.overallPosition,
      classPosition: finalClassPosition(ri),
      scoring: 'points',
      maxChk: r.maxChk,
      checkCount,
      timedCheckCount: timedCheck.filter(Boolean).length,
      totalPoints: r.totalPoints,
      totalEmergencySeconds: r.totalEmergencySeconds,
      pointsBehindOverallLeader: requireAt(requireAt(cum, ri), last).points - overallLeader.points,
      pointsBehindClassLeader: requireAt(requireAt(cum, ri), last).points - classLeader.points,
      avgSpeedTotal: null,
      sections
    };
  });
}

export function deriveStandings(rawRecords: readonly RawRecord[]): RaceEntry[] {
  if (rawRecords[0] && 'scoring' in rawRecords[0] && rawRecords[0].scoring === 'points') return deriveStandingsPoints(rawRecords as readonly RawPointsRecord[]);
  const timedRecords = rawRecords as readonly RawTimedRecord[];
  const n = timedRecords.length;
  const sectionCount = timedRecords[0]?.sectionTimes.length ?? 0;

  // cumulative seconds per racer per section; null from the first missing section on (DNF).
  const cum: (number | null)[][] = timedRecords.map((r) => {
    const out: (number | null)[] = [];
    let acc = 0;
    let dead = false;
    for (let i = 0; i < sectionCount; i++) {
      const st = r.sectionTimes[i];
      if (dead || st == null || st.seconds == null) {
        dead = true;
        out.push(null);
      } else {
        acc += st.seconds;
        out.push(acc);
      }
    }
    return out;
  });

  const cumulativePosition = (si: number, ri: number, sameClass: boolean): number | null => {
    const current = requireAt(timedRecords, ri);
    const me = requireAt(requireAt(cum, ri), si);
    if (me == null) return null;
    let pos = 1;
    for (const [j, otherRecord] of timedRecords.entries()) {
      if (j === ri) continue;
      if (sameClass && otherRecord.className !== current.className) continue;
      const v = requireAt(requireAt(cum, j), si);
      if (v != null && v < me) pos++;
    }
    return pos;
  };

  const gapAhead = (si: number, ri: number): number | null => {
    const me = requireAt(requireAt(cum, ri), si);
    if (me == null) return null;
    let bestAhead: number | null = null;
    for (const [j] of timedRecords.entries()) {
      if (j === ri) continue;
      const v = requireAt(requireAt(cum, j), si);
      if (v != null && v < me && (bestAhead == null || v > bestAhead)) bestAhead = v;
    }
    return bestAhead == null ? 0 : me - bestAhead;
  };

  const sectionClassRank = (si: number, ri: number): number | null => {
    const current = requireAt(timedRecords, ri);
    const st = current.sectionTimes[si];
    if (st == null || st.seconds == null) return null;
    let pos = 1;
    for (const [j, otherRecord] of timedRecords.entries()) {
      if (j === ri) continue;
      if (otherRecord.className !== current.className) continue;
      const o = otherRecord.sectionTimes[si];
      if (o != null && o.seconds != null && o.seconds < st.seconds) pos++;
    }
    return pos;
  };

  const finishedTimedRace = (r: RawTimedRecord): r is RawTimedRecord & { totalTimeSeconds: number } =>
    r.totalTimeSeconds != null && r.sectionTimes.every((st) => st?.seconds != null);

  const totals = timedRecords.filter(finishedTimedRace).map((r) => r.totalTimeSeconds);
  const overallLeaderTotal = totals.length ? Math.min(...totals) : 0;

  const timedClassPosition = (ri: number): number => {
    const me = requireAt(timedRecords, ri);
    let pos = 1;
    for (const [j, other] of timedRecords.entries()) {
      if (j === ri) continue;
      if (other.className !== me.className) continue;
      const otherFinished = finishedTimedRace(other);
      const meFinished = finishedTimedRace(me);
      if (otherFinished && !meFinished) {
        pos++;
      } else if (otherFinished && meFinished && other.totalTimeSeconds < me.totalTimeSeconds) {
        pos++;
      } else if (!otherFinished && !meFinished && other.overallPosition < me.overallPosition) {
        pos++;
      }
    }
    return pos;
  };

  return timedRecords.map((r, ri): TimedRaceEntry => {
    const classMates = timedRecords.filter((x): x is RawTimedRecord & { totalTimeSeconds: number } => x.className === r.className && finishedTimedRace(x));
    const classLeaderTotal = classMates.length ? Math.min(...classMates.map((x) => x.totalTimeSeconds)) : 0;
    const classPosition = timedClassPosition(ri);

    const sections: TimedSection[] = r.sectionTimes.map((st, si) => {
      const gap = gapAhead(si, ri);
      const cumulativeSeconds = requireAt(requireAt(cum, ri), si);
      return {
        sectionName: `Test ${si + 1}`,
        totalCumulatedTime: cumulativeSeconds == null ? null : formatHMS(cumulativeSeconds),
        overallPosition: si === sectionCount - 1 && finishedTimedRace(r) ? r.overallPosition : cumulativePosition(si, ri, false),
        classPosition: si === sectionCount - 1 && finishedTimedRace(r) ? classPosition : cumulativePosition(si, ri, true),
        sectionOverallPosition: st?.publishedPlace ?? null,
        sectionClassPosition: sectionClassRank(si, ri),
        avgSpeed: null,
        overallBehindBy: gap == null ? null : formatHMS(gap)
      };
    });

    return {
      id: r.id,
      fullName: r.fullName,
      displayedNumber: r.displayedNumber,
      brand: r.brand,
      className: r.className,
      overallPosition: r.overallPosition,
      classPosition,
      avgSpeedTotal: null,
      overallBehindByLeader: finishedTimedRace(r) ? formatHMS(r.totalTimeSeconds - overallLeaderTotal) : null,
      classBehindByLeader: finishedTimedRace(r) ? formatHMS(r.totalTimeSeconds - classLeaderTotal) : null,
      sections
    };
  });
}

function buildPath({ org, discipline, year, round, group }: MotoTallyDescriptor, view = 'CS'): string {
  return `${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`;
}

async function fetchDoc(
  path: string,
  fetchImpl: FetchLike = globalThis.fetch,
  parseHtml: ParseHtml = (html) => new DOMParser().parseFromString(html, 'text/html')
): Promise<Document> {
  const response = await fetchImpl(PROXY_PREFIX + path);
  if (!response.ok) throw new Error(`Moto-Tally proxy request failed: ${response.status} ${path}`);
  const html = await response.text();
  return parseHtml(sanitizeHtml(html));
}

function descriptorToRaceId({ org, discipline, year, round, group }: MotoTallyDescriptor): string {
  return `mototally:${org}/${discipline}/${year}/${round}/${group}`;
}

function raceIdToDescriptor(raceId: string): MotoTallyDescriptor {
  const [, path] = raceId.split('mototally:');
  const [org, discipline, year, round, group] = (path ?? '').split('/');
  if (!org || !discipline || !year || !round || !group) throw new UnparseableInputError('Invalid Moto-Tally race ID.');
  return { org, discipline, year, round, group };
}

async function resolveClassToOverall(
  descriptor: MotoTallyDescriptor,
  fetchImpl?: FetchLike,
  parseHtml?: ParseHtml
): Promise<MotoTallyDescriptor> {
  const classDoc = await fetchDoc(buildPath(descriptor), fetchImpl, parseHtml);
  const classAmas = parseAmaSet(classDoc);
  const overallGroups = parseOverallOptions(classDoc);
  const summaries = await Promise.all(
    overallGroups.map(async (group): Promise<GroupSummary> => ({
      group,
      amaSet: parseAmaSet(await fetchDoc(buildPath({ ...descriptor, group }), fetchImpl, parseHtml))
    }))
  );
  const picked = pickContainingGroup(summaries, classAmas);
  return picked ? { ...descriptor, group: picked.group } : descriptor;
}

async function loadOverall(descriptor: MotoTallyDescriptor, fetchImpl?: FetchLike, parseHtml?: ParseHtml): Promise<NormalizedRace & { raceId: string }> {
  const doc = await fetchDoc(buildPath(descriptor), fetchImpl, parseHtml);
  const raceMeta: RaceMeta = { raceName: raceDisplayName(doc, descriptor.group), modeName: 'Enduro' };
  return {
    raceId: descriptorToRaceId(descriptor),
    raceMeta,
    allResults: deriveStandings(parseResults(doc))
  };
}

export async function resolveAndLoadRace(input: unknown, fetchImpl?: FetchLike, parseHtml?: ParseHtml): Promise<NormalizedRace & { raceId: string }> {
  const descriptor = parseMotoTallyUrl(input);
  const overall = descriptor.group.startsWith('O')
    ? descriptor
    : await resolveClassToOverall(descriptor, fetchImpl, parseHtml);
  return loadOverall(overall, fetchImpl, parseHtml);
}

export async function loadRaceById(raceId: string, fetchImpl?: FetchLike, parseHtml?: ParseHtml): Promise<NormalizedRace & { raceId: string }> {
  return loadOverall(raceIdToDescriptor(raceId), fetchImpl, parseHtml);
}
