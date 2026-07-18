import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/archive/database.js';
import {
  buildRacerHistory,
  normalizeRacerName,
  toPercentile
} from '../../server/archive/history.js';
import { createArchive } from '../../server/archive/repository.js';

const CAPTURED_AT = '2026-07-17T00:00:00.000Z';

function loadedRace({
  provider = 'livelaps',
  sourceRaceId = '79103',
  canonicalUrl = `https://example.test/${provider}/${sourceRaceId}`,
  raceName = 'Summer Enduro',
  eventDate = '2026-07-12',
  fullName = 'Áxel-Anderson',
  entryId = 4758874,
  artifactText = '{"raw":true}'
} = {}) {
  return {
    sourceRace: {
      provider,
      sourceRaceId,
      canonicalUrl,
      raceName,
      modeName: 'Enduro',
      eventDate,
      location: 'Scranton, PA',
      organizer: 'ECEA'
    },
    normalized: {
      raceMeta: { raceName, modeName: 'Enduro' },
      allResults: [
        {
          id: entryId,
          fullName,
          displayedNumber: '34D',
          brand: 'Husqvarna',
          className: 'A 40+',
          overallPosition: 2,
          classPosition: 1,
          avgSpeedTotal: 16.073,
          overallBehindByLeader: '00:01:00.000',
          classBehindByLeader: '00:00:00.000',
          sections: [
            {
              sectionName: 'Section 1',
              totalCumulatedTime: '00:22:36.309',
              overallPosition: 2,
              classPosition: 1,
              sectionOverallPosition: 3,
              sectionClassPosition: 1,
              avgSpeed: '15.929',
              overallBehindBy: '00:00:02.349'
            }
          ]
        },
        {
          id: `${entryId}-other`,
          fullName: 'Other Racer',
          className: 'Pro',
          overallPosition: 1,
          classPosition: 1,
          sections: []
        }
      ]
    },
    artifact: {
      mimeType: provider === 'livelaps' ? 'application/json' : 'text/html',
      text: artifactText
    }
  };
}

describe('archive repository', () => {
  let db;
  let archive;

  beforeEach(() => {
    db = openDatabase(':memory:');
    archive = createArchive(db);
  });

  afterEach(() => db.close());

  it('runs the archive migration when the database opens', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(({ name }) => name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'source_races',
        'race_snapshots',
        'race_entries',
        'race_sections'
      ])
    );
  });

  it('keeps immutable snapshots and selects the newest save as current', async () => {
    const loaded = loadedRace();
    await archive.saveSnapshot(loaded, CAPTURED_AT);
    await archive.saveSnapshot(loaded, '2026-07-17T01:00:00.000Z');

    expect(archive.getCurrentSnapshot('livelaps:79103')).toMatchObject({
      capturedAt: '2026-07-17T01:00:00.000Z',
      sourceRace: {
        id: 'livelaps:79103',
        provider: 'livelaps',
        sourceRaceId: '79103'
      },
      normalized: loaded.normalized,
      artifact: loaded.artifact
    });
    expect(archive.findHistory(normalizeRacerName('Áxel-Anderson'))).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM race_snapshots').get().count).toBe(2);
  });

  it('does not replace the Current Snapshot with an older capture', () => {
    const loaded = loadedRace();
    archive.saveSnapshot(loaded, '2026-07-17T02:00:00.000Z');
    archive.saveSnapshot(loaded, '2026-07-17T01:00:00.000Z');

    expect(archive.getCurrentSnapshot('livelaps:79103').capturedAt).toBe(
      '2026-07-17T02:00:00.000Z'
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM race_snapshots').get().count).toBe(2);
  });

  it('keeps Current Snapshot metadata and payload from the newest capture', () => {
    const newer = loadedRace({
      raceName: 'Newer Enduro',
      canonicalUrl: 'https://example.test/livelaps/newer',
      eventDate: '2026-07-18',
      fullName: 'New Racer',
      entryId: 200,
      artifactText: '{"snapshot":"newer"}'
    });
    const older = loadedRace({
      raceName: 'Older Enduro',
      canonicalUrl: 'https://example.test/livelaps/older',
      eventDate: '2026-07-16',
      fullName: 'Old Racer',
      entryId: 100,
      artifactText: '{"snapshot":"older"}'
    });
    archive.saveSnapshot(newer, '2026-07-17T02:00:00.000Z');
    archive.saveSnapshot(older, '2026-07-17T01:00:00.000Z');

    expect(archive.getCurrentSnapshot('livelaps:79103')).toMatchObject({
      capturedAt: '2026-07-17T02:00:00.000Z',
      sourceRace: newer.sourceRace,
      normalized: newer.normalized,
      artifact: newer.artifact
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM race_snapshots').get().count).toBe(2);
  });

  it('round-trips compressed source artifacts', () => {
    const artifactText = '<html>source bytes 🏁</html>';
    archive.saveSnapshot(
      loadedRace({ provider: 'mototally', sourceRaceId: 'ECEA/Enduro/2026/6/O1', artifactText }),
      CAPTURED_AT
    );

    expect(
      archive.getCurrentSnapshot('mototally:ECEA/Enduro/2026/6/O1').artifact
    ).toEqual({ mimeType: 'text/html', text: artifactText });
    expect(db.prepare('SELECT artifact_blob FROM race_snapshots').get().artifact_blob).not.toEqual(
      Buffer.from(artifactText)
    );
  });

  it('uses provider and source ID together as the unique Source Race identity', () => {
    archive.saveSnapshot(loadedRace(), CAPTURED_AT);
    archive.saveSnapshot(loadedRace(), '2026-07-17T01:00:00.000Z');
    archive.saveSnapshot(
      loadedRace({ provider: 'mototally', sourceRaceId: '79103', artifactText: '<html />' }),
      CAPTURED_AT
    );

    expect(db.prepare('SELECT COUNT(*) AS count FROM source_races').get().count).toBe(2);
    expect(archive.findCatalog({ query: '', limit: 10 }).map(({ id }) => id)).toEqual([
      'mototally:79103',
      'livelaps:79103'
    ]);
  });

  it('keeps identical racer and event data from different providers separate', () => {
    archive.saveSnapshot(loadedRace(), CAPTURED_AT);
    archive.saveSnapshot(
      loadedRace({
        provider: 'mototally',
        sourceRaceId: 'ECEA/Enduro/2026/6/O1',
        artifactText: '<html />'
      }),
      '2026-07-17T00:05:00.000Z'
    );

    const history = archive.findHistory(normalizeRacerName('AXEL ANDERSON'));

    expect(history).toHaveLength(2);
    expect(history).toMatchObject([
      { sourceRaceId: 'livelaps:79103', provider: 'livelaps', eventDate: '2026-07-12' },
      {
        sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1',
        provider: 'mototally',
        eventDate: '2026-07-12'
      }
    ]);
  });

  it('returns only matching current entries in event-date order', () => {
    archive.saveSnapshot(
      loadedRace({
        sourceRaceId: 'first',
        eventDate: '2026-06-10',
        fullName: 'Retired Name',
        artifactText: '{"snapshot":"first"}'
      }),
      '2026-07-17T02:00:00.000Z'
    );
    archive.saveSnapshot(
      loadedRace({
        provider: 'mototally',
        sourceRaceId: 'ECEA/Enduro/2026/6/O1',
        eventDate: '2026-07-12',
        fullName: 'AXEL ANDERSON',
        artifactText: '<html>second</html>'
      }),
      '2026-07-17T01:00:00.000Z'
    );
    archive.saveSnapshot(
      loadedRace({
        sourceRaceId: 'first',
        eventDate: '2026-06-10',
        fullName: 'Áxel-Anderson',
        artifactText: '{"snapshot":"replacement"}'
      }),
      '2026-07-17T03:00:00.000Z'
    );
    archive.saveSnapshot(
      loadedRace({ sourceRaceId: 'alias', fullName: 'Anderson Axel' }),
      '2026-07-17T04:00:00.000Z'
    );

    expect(archive.findHistory(normalizeRacerName('AXEL ANDERSON'))).toMatchObject([
      {
        sourceRaceId: 'livelaps:first',
        provider: 'livelaps',
        fullName: 'Áxel-Anderson',
        eventDate: '2026-06-10',
        eventDateProvenance: 'source'
      },
      {
        sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1',
        provider: 'mototally',
        fullName: 'AXEL ANDERSON',
        eventDate: '2026-07-12',
        eventDateProvenance: 'source'
      }
    ]);
  });

  it('does not write when an upstream refresh fails', async () => {
    archive.saveSnapshot(loadedRace(), CAPTURED_AT);
    const refresh = async (load) => archive.saveSnapshot(await load(), '2026-07-17T01:00:00.000Z');

    await expect(refresh(async () => Promise.reject(new Error('upstream unavailable')))).rejects.toThrow(
      'upstream unavailable'
    );

    expect(db.prepare('SELECT COUNT(*) AS count FROM race_snapshots').get().count).toBe(1);
    expect(archive.getCurrentSnapshot('livelaps:79103').capturedAt).toBe(CAPTURED_AT);
  });

  it('rolls back a snapshot when any nested result cannot be persisted', () => {
    const loaded = loadedRace({ sourceRaceId: 'broken' });
    loaded.normalized.allResults[0].sections[0].avgSpeed = Symbol('unsupported');

    expect(() => archive.saveSnapshot(loaded, CAPTURED_AT)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM source_races').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM race_snapshots').get().count).toBe(0);
  });

  it('searches current Source Races by catalog metadata and respects the limit', () => {
    archive.saveSnapshot(loadedRace({ raceName: 'Summer Enduro' }), CAPTURED_AT);
    archive.saveSnapshot(
      loadedRace({ sourceRaceId: '999', raceName: 'Winter Enduro', eventDate: '2026-01-02' }),
      CAPTURED_AT
    );

    expect(archive.findCatalog({ query: 'summer', limit: 10 })).toMatchObject([
      { id: 'livelaps:79103', raceName: 'Summer Enduro' }
    ]);
    expect(archive.findCatalog({ query: 'enduro', limit: 1 })).toHaveLength(1);
  });
});

describe('history transforms', () => {
  it('normalizes case, whitespace, punctuation, and diacritics', () => {
    expect(normalizeRacerName('  Áxel---Anderson  ')).toBe('axel anderson');
  });

  it('turns positions into rounded top-down percentiles', () => {
    expect(toPercentile(1, 4)).toBe(100);
    expect(toPercentile(2, 4)).toBe(75);
    expect(toPercentile(1, 0)).toBeNull();
  });

  it('builds separate provider races and percentile trends from matching entries', () => {
    const history = buildRacerHistory([
      {
        sourceRaceId: 'livelaps:79103',
        provider: 'livelaps',
        raceName: 'June Enduro',
        eventDate: '2026-06-01',
        eventDateProvenance: 'source',
        fullName: 'Áxel-Anderson',
        overallPosition: 2,
        fieldSize: 17,
        classPosition: 1,
        classSize: 4,
        totalTimeSeconds: 960
      },
      {
        sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1',
        provider: 'mototally',
        raceName: 'July Enduro',
        eventDate: '2026-07-12',
        eventDateProvenance: 'source',
        fullName: 'AXEL ANDERSON',
        overallPosition: 7,
        fieldSize: 24,
        classPosition: 2,
        classSize: 5,
        totalTimeSeconds: 1200
      }
    ]);

    expect(history.racerName).toBe('Áxel-Anderson');
    expect(history.races.map((race) => race.provider)).toEqual(['livelaps', 'mototally']);
    expect(history.trends.overallPercentiles).toEqual([94, 75]);
    expect(history.trends.classPercentiles).toEqual([100, 80]);
  });
});
