import { describe, it, expect, beforeAll } from 'vitest';
import { MOTOTALLY_FIXTURE_HTML, docFromHtml } from './fixtures/mototally.fixture.js';
import { parseResults, parseRaceName, parseAmaSet, parseOverallOptions } from '../src/mototally.js';

let doc;
beforeAll(async () => { doc = await docFromHtml(MOTOTALLY_FIXTURE_HTML); });

describe('parseRaceName', () => {
  it('reads the event h1', () => expect(parseRaceName(doc)).toBe('2026 Test Enduro'));
});

describe('parseOverallOptions', () => {
  it('returns only O-codes from the combined dropdown', () => {
    expect(parseOverallOptions(doc)).toEqual(['O1', 'O2']);
  });
});

describe('parseAmaSet', () => {
  it('collects every rider AMA number', () => {
    expect(parseAmaSet(doc)).toEqual(new Set(['111', '222', '333']));
  });
});

describe('parseResults', () => {
  it('parses one raw record per rider, skipping the untimed (0) check', () => {
    const rows = parseResults(doc);
    expect(rows).toHaveLength(3);
    const a = rows[0];
    expect(a).toMatchObject({
      id: 111, fullName: 'RIDER A', displayedNumber: '22A', brand: 'BET',
      className: 'AA', overallPosition: 1, totalTimeSeconds: 300
    });
    expect(a.sectionTimes).toEqual([
      { seconds: 120, publishedPlace: 2 },
      { seconds: 180, publishedPlace: 1 }
    ]);
    expect(rows[1].sectionTimes.map((s) => s.seconds)).toEqual([60, 300]);
  });
});
