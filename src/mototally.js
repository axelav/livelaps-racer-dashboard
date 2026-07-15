import { UnsupportedFormatError, UnparseableInputError } from './livelaps.js';
import { parseClock } from './time.js';

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
      "This race format isn't supported yet — Racer Breakdown currently works with section-based (enduro) races."
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
      brand: cells[6].textContent.trim(),
      className: cells[7].textContent.trim(),
      overallPosition: Number(cells[0].textContent.trim()),
      totalTimeSeconds: parseClock(cells[cells.length - 1].textContent),
      sectionTimes
    };
  });
}
