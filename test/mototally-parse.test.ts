import { describe, it, expect, beforeAll } from 'vitest';
import { MOTOTALLY_FIXTURE_HTML, SPRINT_ENDURO_FIXTURE_HTML, docFromHtml } from './fixtures/mototally.fixture.js';
import { parseResults, parseRaceName, parseAmaSet, parseOverallOptions, pickContainingGroup, deriveStandings } from '../src/mototally.js';
import type { RaceEntry, TimedSection } from '../src/domain.js';
import type { RawTimedRecord } from '../src/mototally.js';

type TimedStanding = Omit<RaceEntry, 'sections' | 'classPosition'> & { sections: TimedSection[]; classPosition: number | null };

let doc: Document;
beforeAll(async () => {
  doc = await docFromHtml(MOTOTALLY_FIXTURE_HTML);
});

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
    const rows = parseResults(doc) as RawTimedRecord[];
    expect(rows).toHaveLength(3);
    const a = rows[0];
    const b = rows[1];
    if (!a || !b) throw new Error('Expected timed raw records in fixture');
    expect(a).toMatchObject({
      id: 111, fullName: 'RIDER A', displayedNumber: '22A', brand: 'BET',
      className: 'AA', overallPosition: 1, totalTimeSeconds: 300
    });
    expect(a.sectionTimes).toEqual([
      { seconds: 120, publishedPlace: 2 },
      { seconds: 180, publishedPlace: 1 }
    ]);
    expect(b.sectionTimes.map((s) => s?.seconds)).toEqual([60, 300]);
    expect(rows.map((r) => r.brand)).toEqual(['BET', 'KTM', 'GAS']);
  });
});

describe('parseResults for Sprint Enduros', () => {
  it('preserves decimal test times, source labels, and partial DNF results', async () => {
    const sprintDoc = await docFromHtml(SPRINT_ENDURO_FIXTURE_HTML);
    const rows = parseResults(sprintDoc) as RawTimedRecord[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      fullName: 'TANNER WOLFRUM',
      totalTimeSeconds: 1292
    });
    expect(rows[0]?.sectionTimes.map((section) => section?.seconds)).toEqual([269, 264, 759]);

    const standings = deriveStandings(rows) as TimedStanding[];
    const winner = standings.find((entry) => entry.fullName === 'TANNER WOLFRUM');
    const dnf = standings.find((entry) => entry.fullName === 'LOGAN MORLEY');
    expect(winner?.sections.map((section) => section.sectionName)).toEqual(['T1 1', 'T1 2', 'T2 1']);
    expect(winner?.sections.map((section) => section.totalCumulatedTime)).toEqual([
      '0:04:29.000',
      '0:08:53.000',
      '0:21:32.000'
    ]);
    expect(dnf).toMatchObject({
      overallPosition: null,
      classPosition: null,
      sections: [
        { totalCumulatedTime: '0:04:38.000' },
        { totalCumulatedTime: '0:09:17.000' },
        { totalCumulatedTime: null }
      ]
    });
  });

  it('resumes Sprint cumulative timing after an uncompleted test', () => {
    const [dnf] = deriveStandings([
      {
        id: 7487410,
        fullName: 'LOGAN MORLEY',
        displayedNumber: '172',
        brand: 'KTM',
        className: 'AA',
        overallPosition: null,
        totalTimeSeconds: 1759,
        isSprint: true,
        sectionNames: ['T1 1', 'T1 2', 'T2 1', 'T3 1'],
        timePrecision: 3,
        sectionTimes: [
          { seconds: 278, publishedPlace: null },
          null,
          { seconds: 892, publishedPlace: null },
          { seconds: 589, publishedPlace: null }
        ]
      }
    ]) as TimedStanding[];

    expect(dnf).toMatchObject({
      overallPosition: null,
      classPosition: null,
      sections: [
        { totalCumulatedTime: '0:04:38.000' },
        { totalCumulatedTime: null },
        { totalCumulatedTime: '0:19:30.000' },
        { totalCumulatedTime: '0:29:19.000' }
      ]
    });
  });
});

describe('deriveStandings for timed races', () => {
  it('ranks DNFs behind timed finishers within the class', () => {
    const standings = deriveStandings([
      {
        id: 1,
        fullName: 'FINISHER A',
        displayedNumber: '1A',
        brand: 'KTM',
        className: 'A',
        overallPosition: 1,
        totalTimeSeconds: 300,
        sectionTimes: [{ seconds: 100, publishedPlace: 1 }, { seconds: 200, publishedPlace: 1 }]
      },
      {
        id: 2,
        fullName: 'DNF RIDER',
        displayedNumber: '2A',
        brand: 'HUS',
        className: 'A',
        overallPosition: 10,
        totalTimeSeconds: 90,
        sectionTimes: [{ seconds: 90, publishedPlace: 1 }, null]
      },
      {
        id: 3,
        fullName: 'FINISHER B',
        displayedNumber: '3A',
        brand: 'BET',
        className: 'A',
        overallPosition: 2,
        totalTimeSeconds: 320,
        sectionTimes: [{ seconds: 110, publishedPlace: 2 }, { seconds: 210, publishedPlace: 2 }]
      }
    ]);

    expect(standings.find((r) => r.fullName === 'DNF RIDER')).toMatchObject({
      classPosition: 3,
      classBehindByLeader: null,
      overallBehindByLeader: null
    });
  });

  it('uses the official final positions for the last timed section', () => {
    const standings = deriveStandings([
      {
        id: 1,
        fullName: 'RYAN',
        displayedNumber: '21A',
        brand: 'KTM',
        className: 'AA',
        overallPosition: 33,
        totalTimeSeconds: 2189,
        sectionTimes: [{ seconds: 10, publishedPlace: 6 }, { seconds: 10, publishedPlace: 2 }]
      },
      {
        id: 2,
        fullName: 'CLASSMATE',
        displayedNumber: '22A',
        brand: 'KTM',
        className: 'AA',
        overallPosition: 13,
        totalTimeSeconds: 2000,
        sectionTimes: [{ seconds: 5, publishedPlace: 1 }, { seconds: 30, publishedPlace: 10 }]
      },
      {
        id: 3,
        fullName: 'OTHER CLASS',
        displayedNumber: '23A',
        brand: 'KTM',
        className: 'A',
        overallPosition: 1,
        totalTimeSeconds: 1000,
        sectionTimes: [{ seconds: 1, publishedPlace: 1 }, { seconds: 1, publishedPlace: 1 }]
      }
    ]);

    const ryan = standings.find((r) => r.fullName === 'RYAN') as TimedStanding | undefined;
    if (!ryan) throw new Error('Expected RYAN in derived standings');
    expect(ryan.sections[0]).toMatchObject({ overallPosition: 3, classPosition: 2 });
    expect(ryan.sections.at(-1)).toMatchObject({ overallPosition: 33, classPosition: ryan.classPosition });
  });
});

describe('pickContainingGroup', () => {
  const classAmas = new Set(['111', '222']);
  it('picks the largest overall page that contains all class riders', () => {
    const summaries = [
      { group: 'O1', amaSet: new Set(['111', '222', '333', '444']) }, // biggest, contains
      { group: 'O2', amaSet: new Set(['111', '222', '333']) },        // contains, smaller
      { group: 'O5', amaSet: new Set(['555', '666']) }                // does not contain
    ];
    expect(pickContainingGroup(summaries, classAmas)?.group).toBe('O1');
  });
  it('returns null when no overall page contains the class', () => {
    expect(pickContainingGroup([{ group: 'O5', amaSet: new Set(['999']) }], classAmas)).toBeNull();
  });
});
