import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docFromHtml } from './fixtures/mototally.fixture.js';
import { sanitizeHtml, parseResults, deriveStandings } from '../src/mototally.js';
import { deriveTotals } from '../src/livelaps.js';

// Real ECEA page fragment (2026 Foggy Mountain Enduro, OVERALL Long Course),
// broken `</span` brand markup intact. 79 finishers + DNF rows.
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/foggy-mountain-o1.html', import.meta.url));

let raw;
let standings;

beforeAll(async () => {
  const html = sanitizeHtml(readFileSync(FIXTURE_PATH, 'utf8'));
  const doc = await docFromHtml(html);
  raw = parseResults(doc);
  standings = deriveStandings(raw);
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
    const axel = raw.find((r) => r.fullName === 'AXEL ANDERSON');
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
    const axel = raw.find((r) => r.fullName === 'AXEL ANDERSON');
    expect(axel.checks[0]).toEqual({ points: 0, seconds: null, publishedPlace: null });
    expect(axel.checks[2]).toEqual({ points: 11, seconds: 656, publishedPlace: 53 });
    const quirin = raw.find((r) => r.fullName === 'COLIN QUIRIN');
    expect(quirin.maxChk).toBe(7);
    expect(quirin.checks[6]).toEqual({ points: 2, seconds: null, publishedPlace: null });
    expect(quirin.checks[7]).toBeNull();
  });

  it('parses a zero-point emergency check', () => {
    const bizzari = raw.find((r) => r.fullName === 'KRIS BIZZARI');
    expect(bizzari.checks[3]).toEqual({ points: 0, seconds: 12, publishedPlace: 5 });
  });
});

describe('deriveStandings for points scoring', () => {
  it('recovers each published place from cumulative data (dead heats share the better place)', () => {
    const mismatches = standings.filter(
      (r) => r.sections[r.sections.length - 1].overallPosition !== r.overallPosition
    );
    // Nowakowski and Barnhardt are an exact dead heat (13 checks, 35/843); the
    // published tiebreak comes from the rulebook, not the table, so at the last
    // check both share place 11.
    expect(mismatches.map((r) => r.fullName)).toEqual(['TANNER BARNHARDT']);
    expect(mismatches[0].sections[12].overallPosition).toBe(11);
    expect(mismatches[0].overallPosition).toBe(12);
  });

  it('derives class standings with the same comparator', () => {
    const axel = standings.find((r) => r.fullName === 'AXEL ANDERSON');
    expect(axel.classPosition).toBe(5);
    const bizzari = standings.find((r) => r.fullName === 'KRIS BIZZARI');
    expect(bizzari.classPosition).toBe(6); // 50 pts tie vs Axel, broken by 1273 > 1252 seconds
    const quirin = standings.find((r) => r.fullName === 'COLIN QUIRIN');
    expect(quirin.classPosition).toBe(9); // fewest points in class, but only 7 of 13 checks
    const hodgson = standings.find((r) => r.fullName === 'TONY HODGSON');
    expect(hodgson.classPosition).toBe(10);
  });

  it('integrates with deriveTotals for field and class sizes', () => {
    const totals = deriveTotals(standings, 3279244);
    expect(totals.fieldSize).toBe(79);
    expect(totals.classSize).toBe(10);
  });

  it('reports points behind the overall and class leaders', () => {
    const axel = standings.find((r) => r.fullName === 'AXEL ANDERSON');
    expect(axel.pointsBehindOverallLeader).toBe(25); // leader 25/599
    expect(axel.pointsBehindClassLeader).toBe(20); // class leader 30/733
    const leader = standings.find((r) => r.overallPosition === 1);
    expect(leader.pointsBehindOverallLeader).toBe(0);
  });

  it('builds per-check sections with cumulative points and standing', () => {
    const axel = standings.find((r) => r.fullName === 'AXEL ANDERSON');
    expect(axel.scoring).toBe('points');
    expect(axel.sections).toHaveLength(13);
    const last = axel.sections[12];
    expect(last).toMatchObject({
      cumPoints: 50,
      cumSeconds: 1252,
      overallPosition: 47,
      classPosition: 5
    });
    const check3 = axel.sections[2];
    expect(check3).toMatchObject({
      sectionName: 'Check 3',
      timed: true,
      points: 11,
      seconds: 656,
      publishedPlace: 53,
      cumPoints: 11,
      cumSeconds: 656
    });
    const check1 = axel.sections[0];
    expect(check1).toMatchObject({ timed: false, points: 0, seconds: null, publishedPlace: null });
  });

  it('freezes cumulative totals when a rider stops reaching checks', () => {
    const hodgson = standings.find((r) => r.fullName === 'TONY HODGSON');
    expect(hodgson.sections[4].cumPoints).toBe(49);
    expect(hodgson.sections[4].cumSeconds).toBe(2925);
    expect(hodgson.sections[12].cumPoints).toBe(49);
    expect(hodgson.sections[12].cumSeconds).toBe(2925);
  });
});
