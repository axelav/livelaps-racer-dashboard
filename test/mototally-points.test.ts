import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docFromHtml } from './fixtures/mototally.fixture.js';
import { sanitizeHtml, parseResults, deriveStandings, raceDisplayName } from '../src/mototally.js';
import { deriveTotals } from '../src/livelaps.js';
import type { PointsSection, RaceEntry } from '../src/domain.js';
import type { RawPointsRecord } from '../src/mototally.js';

type PointsStanding = RaceEntry & {
  scoring: 'points';
  sections: PointsSection[];
  overallPosition: number;
  classPosition: number;
  pointsBehindOverallLeader: number;
  pointsBehindClassLeader: number;
};

function findRaw(fullName: string): RawPointsRecord {
  const record = raw.find((r) => r.fullName === fullName);
  if (!record) throw new Error(`Expected raw points fixture rider: ${fullName}`);
  return record;
}

function findStanding(fullName: string): PointsStanding {
  const record = standings.find((r) => r.fullName === fullName);
  if (!record) throw new Error(`Expected points standing rider: ${fullName}`);
  return record;
}

function findStandingByOverallPosition(overallPosition: number): PointsStanding {
  const record = standings.find((r) => r.overallPosition === overallPosition);
  if (!record) throw new Error(`Expected points standing in overall position ${overallPosition}`);
  return record;
}

function sectionAt(record: PointsStanding, index: number): PointsSection {
  const section = record.sections[index];
  if (!section) throw new Error(`Expected section ${index + 1} for ${record.fullName}`);
  return section;
}


// Real ECEA page fragment (2026 Foggy Mountain Enduro, OVERALL Long Course),
// broken `</span` brand markup intact. 79 finishers + DNF rows.
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/foggy-mountain-o1.html', import.meta.url));

let doc: Document;
let raw: RawPointsRecord[];
let standings: PointsStanding[];

beforeAll(async () => {
  const html = sanitizeHtml(readFileSync(FIXTURE_PATH, 'utf8'));
  doc = await docFromHtml(html);
  raw = parseResults(doc) as RawPointsRecord[];
  standings = deriveStandings(raw) as PointsStanding[];
});

describe('raceDisplayName', () => {
  // Events can split into disjoint courses (Long/Short); the course label from
  // Moto-Tally's own dropdown disambiguates the archived races.
  it('appends the course label when the event has multiple overall groups', () => {
    expect(raceDisplayName(doc, 'O1')).toBe('2026 Foggy Mountain Enduro — Long Course');
    expect(raceDisplayName(doc, 'O5')).toBe('2026 Foggy Mountain Enduro — Short');
  });

  it('falls back to the plain event name for unknown or class groups', () => {
    expect(raceDisplayName(doc, 'C8')).toBe('2026 Foggy Mountain Enduro');
    expect(raceDisplayName(doc, 'O99')).toBe('2026 Foggy Mountain Enduro');
  });
});

describe('sanitizeHtml', () => {
  it('closes the broken brand span so cell boundaries survive browser parsing', () => {
    expect(sanitizeHtml("<td><span class='bb Husqvarna'>HUS</span</td><td>A SR 40+</td>")).toBe(
      "<td><span class='bb Husqvarna'>HUS</span></td><td>A SR 40+</td>"
    );
  });
  it('leaves well-formed markup alone', () => {
    expect(sanitizeHtml('<td><span>OK</span></td>')).toBe('<td><span>OK</span></td>');
  });
});

describe('parseResults on a points-scored race', () => {
  it('parses every finisher and skips DNF rows', () => {
    expect(raw).toHaveLength(79);
  });

  it('reads fixed columns and totals from a real row', () => {
    const axel = findRaw('AXEL ANDERSON');
    expect(axel).toMatchObject({
      id: 3279244,
      displayedNumber: '17B',
      brand: 'HUS',
      className: 'A SR 40+',
      overallPosition: 47,
      scoring: 'points',
      maxChk: 13,
      totalPoints: 50,
      totalEmergencySeconds: 1252
    });
    expect(axel.checks).toHaveLength(13);
  });

  it('parses route checks, emergency checks, and unreached checks', () => {
    const axel = findRaw('AXEL ANDERSON');
    expect(axel.checks[0]).toEqual({ points: 0, seconds: null, publishedPlace: null });
    expect(axel.checks[2]).toEqual({ points: 11, seconds: 656, publishedPlace: 53 });
    const quirin = findRaw('COLIN QUIRIN');
    expect(quirin.maxChk).toBe(7);
    expect(quirin.checks[6]).toEqual({ points: 2, seconds: null, publishedPlace: null });
    expect(quirin.checks[7]).toBeNull();
  });

  it('parses a zero-point emergency check', () => {
    const bizzari = findRaw('KRIS BIZZARI');
    expect(bizzari.checks[3]).toEqual({ points: 0, seconds: 12, publishedPlace: 5 });
  });
});

describe('deriveStandings for points scoring', () => {
  it('recovers each published place from cumulative data (dead heats share the better place)', () => {
    const mismatches = standings.filter(
      (r) => sectionAt(r, r.sections.length - 1).overallPosition !== r.overallPosition
    );
    // Nowakowski and Barnhardt are an exact dead heat (13 checks, 35/843); the
    // published tiebreak comes from the rulebook, not the table, so at the last
    // check both share place 11.
    expect(mismatches.map((r) => r.fullName)).toEqual(['TANNER BARNHARDT']);
    const mismatch = mismatches[0];
    if (!mismatch) throw new Error('Expected a published-place mismatch');
    expect(sectionAt(mismatch, 12).overallPosition).toBe(11);
    expect(mismatch.overallPosition).toBe(12);
  });

  it('derives class standings with the same comparator', () => {
    const axel = findStanding('AXEL ANDERSON');
    expect(axel.classPosition).toBe(5);
    const bizzari = findStanding('KRIS BIZZARI');
    expect(bizzari.classPosition).toBe(6); // 50 pts tie vs Axel, broken by 1273 > 1252 seconds
    const quirin = findStanding('COLIN QUIRIN');
    expect(quirin.classPosition).toBe(9); // fewest points in class, but only 7 of 13 checks
    const hodgson = findStanding('TONY HODGSON');
    expect(hodgson.classPosition).toBe(10);
  });

  it('integrates with deriveTotals for field and class sizes', () => {
    const totals = deriveTotals(standings, 3279244);
    if (!totals) throw new Error('Expected totals for AXEL ANDERSON');
    expect(totals.fieldSize).toBe(79);
    expect(totals.classSize).toBe(10);
  });

  it('reports points behind the overall and class leaders', () => {
    const axel = findStanding('AXEL ANDERSON');
    expect(axel.pointsBehindOverallLeader).toBe(25); // leader 25/599
    expect(axel.pointsBehindClassLeader).toBe(20); // class leader 30/733
    const leader = findStandingByOverallPosition(1);
    expect(leader.pointsBehindOverallLeader).toBe(0);
  });

  it('builds per-check sections with cumulative points and standing', () => {
    const axel = findStanding('AXEL ANDERSON');
    expect(axel.scoring).toBe('points');
    expect(axel.sections).toHaveLength(13);
    const last = sectionAt(axel, 12);
    expect(last).toMatchObject({
      cumPoints: 50,
      cumSeconds: 1252,
      overallPosition: 47,
      classPosition: 5
    });
    const check3 = sectionAt(axel, 2);
    expect(check3).toMatchObject({
      sectionName: 'Check 3',
      timed: true,
      points: 11,
      seconds: 656,
      publishedPlace: 53,
      cumPoints: 11,
      cumSeconds: 656
    });
    const check1 = sectionAt(axel, 0);
    expect(check1).toMatchObject({ timed: false, points: 0, seconds: null, publishedPlace: null });
  });

  it('computes check-alone ranks for every check, matching every published place at timed checks', () => {
    let compared = 0;
    for (const r of standings) {
      for (const s of r.sections) {
        if (s.publishedPlace != null) {
          compared++;
          expect(s.sectionOverallPosition).toBe(s.publishedPlace);
        }
      }
    }
    expect(compared).toBeGreaterThan(200); // 79 riders × up to 3 timed checks

    const axel = findStanding('AXEL ANDERSON');
    // A SR 40+ seconds at the timed checks — verified by hand against the fixture.
    expect(sectionAt(axel, 2).sectionClassPosition).toBe(6); // 656s, 5 classmates faster
    expect(sectionAt(axel, 3).sectionClassPosition).toBe(7); // 79s
    expect(sectionAt(axel, 4).sectionClassPosition).toBe(7); // 517s
    // route checks rank on points; everyone who dropped 0 shares 1st
    expect(sectionAt(axel, 0).sectionOverallPosition).toBe(1);
    expect(sectionAt(axel, 0).sectionClassPosition).toBe(1);
    expect(sectionAt(axel, 12).sectionOverallPosition).toBe(37); // dropped 10 on the last check
    const bizzari = findStanding('KRIS BIZZARI');
    expect(sectionAt(bizzari, 3).sectionClassPosition).toBe(1); // 12s, fastest in class
    // riders who never reached a check have no rank there
    const quirin = findStanding('COLIN QUIRIN');
    expect(sectionAt(quirin, 7).sectionOverallPosition).toBeNull();
  });

  it('freezes cumulative totals when a rider stops reaching checks', () => {
    const hodgson = findStanding('TONY HODGSON');
    expect(sectionAt(hodgson, 4).cumPoints).toBe(49);
    expect(sectionAt(hodgson, 4).cumSeconds).toBe(2925);
    expect(sectionAt(hodgson, 12).cumPoints).toBe(49);
    expect(sectionAt(hodgson, 12).cumSeconds).toBe(2925);
  });
});
