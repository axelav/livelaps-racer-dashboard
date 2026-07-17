import { UnsupportedFormatError, UnparseableInputError } from './livelaps.js';
import { parseClock, formatHMS } from './time.js';

const URL_PATTERN =
  /moto-tally\.com\/([^/]+)\/([^/]+)\/Results\.aspx\/(\d+)\/(\d+)\/([OC]\d+)\/([A-Za-z]+)/i;

export function isMotoTallyUrl(input) {
  return typeof input === 'string' && /moto-tally\.com/i.test(input);
}

export function parseMotoTallyUrl(input) {
  const match = typeof input === 'string' ? input.match(URL_PATTERN) : null;
  if (!match) {
    throw new UnparseableInputError(
      "Couldn't read that Moto-Tally link — copy the full results page URL and try again."
    );
  }
  const [, org, discipline, year, round, group, view] = match;
  if (discipline.toLowerCase() !== 'enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Enduro Breakdown currently works with section-based races."
    );
  }
  return { org, discipline, year, round, group, view };
}

const FIXED_COLS = 8; // EventPlace, AMA#, Row, Name, Club, Sponsors, Brand, Class
const TRAILING_COLS = 2; // MaxChk, TotalTime

function dataRows(doc) {
  const table = doc.querySelector('#mtR_gvResults');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).filter((tr) => {
    const first = tr.querySelector('td');
    return first && /^\d+$/.test(first.textContent.trim());
  });
}

function cellsOf(tr) {
  return Array.from(tr.querySelectorAll('td'));
}

// A check cell is "M:SS (place)" when timed, or "0"/blank when an untimed checkpoint.
function parseCheckCell(td) {
  const text = td.textContent.replace(/ /g, ' ').trim();
  const m = text.match(/^(\d+:\d{2})\s*\((\d+)\)$/);
  if (!m) return null;
  return { seconds: parseClock(m[1]), publishedPlace: Number(m[2]) };
}

export function parseRaceName(doc) {
  return doc.querySelector('#mtR_h1RREventName')?.textContent.trim() ?? '';
}

export function parseOverallOptions(doc) {
  const select = doc.querySelector('#mtR_ddlSelectClass');
  if (!select) return [];
  return Array.from(select.querySelectorAll('option'))
    .map((o) => o.getAttribute('value'))
    .filter((v) => /^O\d+$/.test(v));
}

export function parseAmaSet(doc) {
  return new Set(dataRows(doc).map((tr) => cellsOf(tr)[1].textContent.trim()));
}

export function pickContainingGroup(summaries, classAmaSet) {
  const containing = summaries.filter((s) =>
    [...classAmaSet].every((ama) => s.amaSet.has(ama))
  );
  if (containing.length === 0) return null;
  return containing.reduce((best, s) => (s.amaSet.size > best.amaSet.size ? s : best));
}

export function parseResults(doc) {
  const rows = dataRows(doc);
  if (rows.length === 0) return [];

  // Timed columns = check columns where the winner (first data row) has a time.
  const winnerCells = cellsOf(rows[0]);
  const checkStart = FIXED_COLS;
  const checkEnd = winnerCells.length - TRAILING_COLS; // exclusive
  const timedCols = [];
  for (let c = checkStart; c < checkEnd; c++) {
    if (parseCheckCell(winnerCells[c]) !== null) timedCols.push(c);
  }

  return rows.map((tr) => {
    const cells = cellsOf(tr);
    const sectionTimes = timedCols.map((c) => parseCheckCell(cells[c])); // null = DNF at that section
    return {
      id: Number(cells[1].textContent.trim()),
      fullName: cells[3].textContent.trim(),
      displayedNumber: cells[2].textContent.trim(),
      brand: (cells[6].querySelector('span')?.textContent ?? cells[6].textContent).replace(/<.*$/s, '').trim(),
      className: cells[7].textContent.trim(),
      overallPosition: Number(cells[0].textContent.trim()),
      totalTimeSeconds: parseClock(cells[cells.length - 1].textContent),
      sectionTimes
    };
  });
}

export function deriveStandings(rawRecords) {
  const n = rawRecords.length;
  const sectionCount = rawRecords[0]?.sectionTimes.length ?? 0;

  // cumulative seconds per racer per section; null from the first missing section on (DNF).
  const cum = rawRecords.map((r) => {
    const out = [];
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

  const cumulativePosition = (si, ri, sameClass) => {
    const me = cum[ri][si];
    if (me == null) return null;
    let pos = 1;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      if (sameClass && rawRecords[j].className !== rawRecords[ri].className) continue;
      const v = cum[j][si];
      if (v != null && v < me) pos++;
    }
    return pos;
  };

  const gapAhead = (si, ri) => {
    const me = cum[ri][si];
    if (me == null) return null;
    let bestAhead = null;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      const v = cum[j][si];
      if (v != null && v < me && (bestAhead == null || v > bestAhead)) bestAhead = v;
    }
    return bestAhead == null ? 0 : me - bestAhead;
  };

  const sectionClassRank = (si, ri) => {
    const st = rawRecords[ri].sectionTimes[si];
    if (st == null || st.seconds == null) return null;
    let pos = 1;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      if (rawRecords[j].className !== rawRecords[ri].className) continue;
      const o = rawRecords[j].sectionTimes[si];
      if (o != null && o.seconds != null && o.seconds < st.seconds) pos++;
    }
    return pos;
  };

  const totals = rawRecords.map((r) => r.totalTimeSeconds).filter((v) => v != null);
  const overallLeaderTotal = totals.length ? Math.min(...totals) : 0;

  return rawRecords.map((r, ri) => {
    const classMates = rawRecords.filter((x) => x.className === r.className && x.totalTimeSeconds != null);
    const classLeaderTotal = classMates.length ? Math.min(...classMates.map((x) => x.totalTimeSeconds)) : 0;
    const classPosition = 1 + classMates.filter((x) => x.totalTimeSeconds < r.totalTimeSeconds).length;

    const sections = r.sectionTimes.map((st, si) => {
      const gap = gapAhead(si, ri);
      return {
        sectionName: `Test ${si + 1}`,
        totalCumulatedTime: cum[ri][si] == null ? null : formatHMS(cum[ri][si]),
        overallPosition: cumulativePosition(si, ri, false),
        classPosition: cumulativePosition(si, ri, true),
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
      overallBehindByLeader: r.totalTimeSeconds == null ? null : formatHMS(r.totalTimeSeconds - overallLeaderTotal),
      classBehindByLeader: r.totalTimeSeconds == null ? null : formatHMS(r.totalTimeSeconds - classLeaderTotal),
      sections
    };
  });
}

export const PROXY_PREFIX = '/proxy/mototally/';

function buildPath({ org, discipline, year, round, group }, view = 'CS') {
  return `${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`;
}

async function fetchDoc(path) {
  const response = await fetch(PROXY_PREFIX + path);
  if (!response.ok) throw new Error(`Moto-Tally proxy request failed: ${response.status} ${path}`);
  const html = await response.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

function descriptorToRaceId({ org, discipline, year, round, group }) {
  return `mototally:${org}/${discipline}/${year}/${round}/${group}`;
}

function raceIdToDescriptor(raceId) {
  const [, path] = raceId.split('mototally:');
  const [org, discipline, year, round, group] = path.split('/');
  return { org, discipline, year, round, group };
}

async function resolveClassToOverall(descriptor) {
  const classDoc = await fetchDoc(buildPath(descriptor));
  const classAmas = parseAmaSet(classDoc);
  const overallGroups = parseOverallOptions(classDoc);
  const summaries = await Promise.all(
    overallGroups.map(async (group) => ({
      group,
      amaSet: parseAmaSet(await fetchDoc(buildPath({ ...descriptor, group })))
    }))
  );
  const picked = pickContainingGroup(summaries, classAmas);
  return picked ? { ...descriptor, group: picked.group } : descriptor;
}

async function loadOverall(descriptor) {
  const doc = await fetchDoc(buildPath(descriptor));
  return {
    raceId: descriptorToRaceId(descriptor),
    raceMeta: { raceName: parseRaceName(doc), modeName: 'Enduro' },
    allResults: deriveStandings(parseResults(doc))
  };
}

export async function resolveAndLoadRace(input) {
  const descriptor = parseMotoTallyUrl(input);
  const overall = descriptor.group.startsWith('O') ? descriptor : await resolveClassToOverall(descriptor);
  return loadOverall(overall);
}

export async function loadRaceById(raceId) {
  return loadOverall(raceIdToDescriptor(raceId));
}
