import { describe, expect, it, vi } from 'vitest';
import { createArchive } from '../../server/archive/repository.js';
import { openDatabase } from '../../server/archive/database.js';
import {
  ANEC_PROMOTER_ID,
  backfillLiveLapsArchive,
  createCachedLiveLapsFetch,
  discoverLiveLapsPromoterEvents,
  parseBackfillArgs
} from '../../server/backfill/livelaps.js';

const LIVE_LAPS_API = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';
const PROMOTER_EVENTS_URL = `${LIVE_LAPS_API}promoter/${ANEC_PROMOTER_ID}/events`;
const EVENT_RACES_URL = `${LIVE_LAPS_API}race/event/40001`;
const ENDURO_RACE_URL = `${LIVE_LAPS_API}race/81001`;
const ENDURO_RESULTS_URL = `${LIVE_LAPS_API}race/results/81001?page=1&size=1000`;
const UNSUPPORTED_RACE_URL = `${LIVE_LAPS_API}race/81002`;
const UNSUPPORTED_RESULTS_URL = `${LIVE_LAPS_API}race/results/81002?page=1&size=1000`;
const NEXT_RACE_URL = `${LIVE_LAPS_API}race/81003`;
const NEXT_RESULTS_URL = `${LIVE_LAPS_API}race/results/81003?page=1&size=1000`;
type FetchInput = Parameters<typeof fetch>[0];
type LiveLapsBackfillArgs = {
  sinceYear: number;
  dbPath: string;
  delayMs: number;
  promoters: Array<{ id: number; label: string }>;
};

function inputUrl(input: FetchInput): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}


function responseJson(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json)
  } as Response;
}

function promoterEvents() {
  return {
    success: 1,
    message: [
      {
        id: 50000,
        eventDate: '2024-05-01',
        eventYear: '2024',
        name: 'Future event without results',
        promoterUserId: ANEC_PROMOTER_ID,
        promoterName: 'American National Enduro (ANEC)',
        raceCount: 1
      },
      {
        id: 40001,
        eventDate: '2024-03-10',
        eventYear: '2024',
        name: '2024 NEPG National Enduro',
        promoterUserId: ANEC_PROMOTER_ID,
        promoterName: 'American National Enduro (ANEC)',
        raceCount: 2
      },
      {
        id: 30001,
        eventDate: '2023-03-10',
        eventYear: '2023',
        name: 'Old NEPG National Enduro',
        promoterUserId: ANEC_PROMOTER_ID,
        promoterName: 'American National Enduro (ANEC)',
        raceCount: 1
      },
      {
        id: 40002,
        eventDate: '2024-03-11',
        eventYear: '2024',
        name: 'Registration-only event',
        promoterUserId: ANEC_PROMOTER_ID,
        promoterName: 'American National Enduro (ANEC)',
        raceCount: 0
      }
    ]
  };
}

function eventRaces(ids: number[] = [81001, 81002]) {
  return {
    success: 1,
    message: ids.map((id) => ({
      id,
      eventId: 40001,
      raceName: `Race ${id}`,
      scoring_status: 'completed'
    }))
  };
}

function racePayload({ name = '2024 NEPG National Enduro', modeName = 'Enduro' } = {}) {
  return {
    success: 1,
    message: {
      Race_Name: name,
      RACE_MODE_NAME: modeName,
      Event_Date: '2024-03-10',
      Promoter_Name: 'American National Enduro (ANEC)'
    }
  };
}

function resultsPayload(id: number) {
  return {
    success: 1,
    data: [
      {
        id,
        fullName: `RIDER ${id}`,
        className: 'AA',
        overallPosition: 1,
        classPosition: 1,
        sections: []
      }
    ],
    has_more_pages: false,
    total: 1
  };
}

describe('parseBackfillArgs', () => {
  it('defaults to ANEC/NEPG and treats a positional year as the inclusive cutoff', () => {
    expect(parseBackfillArgs(['2024'], { ENDURO_DB_PATH: '/tmp/enduro.db' }) as LiveLapsBackfillArgs).toEqual({
      sinceYear: 2024,
      dbPath: '/tmp/enduro.db',
      delayMs: 2000,
      promoters: [{ id: ANEC_PROMOTER_ID, label: 'ANEC/NEPG' }]
    });
  });

  it('accepts explicit promoter ids for ad hoc LiveLaps backfills', () => {
    expect(parseBackfillArgs(['--', '--since-year=2025', '--db', ':memory:', '--promoter-id', '5792'], {}) as LiveLapsBackfillArgs)
      .toEqual({
        sinceYear: 2025,
        dbPath: ':memory:',
        delayMs: 2000,
        promoters: [{ id: 5792, label: '5792' }]
      });
  });
});

describe('discoverLiveLapsPromoterEvents', () => {
  it('discovers past race-bearing promoter events at or after the cutoff', () => {
    expect(discoverLiveLapsPromoterEvents(promoterEvents().message, {
      sinceYear: 2024,
      currentDate: new Date('2024-03-12T00:00:00.000Z')
    })).toEqual([
      {
        eventId: '40001',
        eventName: '2024 NEPG National Enduro',
        eventDate: '2024-03-10',
        promoterId: String(ANEC_PROMOTER_ID),
        promoterName: 'American National Enduro (ANEC)',
        raceCount: 2
      }
    ]);
  });
});

describe('createCachedLiveLapsFetch', () => {
  it('serializes uncached requests with delay and reuses cached JSON responses without waiting', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => responseJson({ success: 1, message: `body:${inputUrl(url)}` }));
    const fetchImpl = createCachedLiveLapsFetch({
      fetchImpl: upstream,
      delayMs: 2000,
      now: () => now,
      wait: async (ms: number): Promise<void> => {
        waits.push(ms);
        now += ms;
      }
    });

    await expect(fetchImpl('https://example.test/a', undefined).then((r) => r.json()))
      .resolves.toEqual({ success: 1, message: 'body:https://example.test/a' });
    await expect(fetchImpl('https://example.test/a', undefined).then((r) => r.json()))
      .resolves.toEqual({ success: 1, message: 'body:https://example.test/a' });
    await expect(fetchImpl('https://example.test/b', undefined).then((r) => r.json()))
      .resolves.toEqual({ success: 1, message: 'body:https://example.test/b' });

    expect(upstream).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2000]);
  });
});

describe('backfillLiveLapsArchive', () => {
  it('archives supported ANEC/NEPG races and skips unsupported LiveLaps race modes', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === PROMOTER_EVENTS_URL) return responseJson(promoterEvents());
      if (href === EVENT_RACES_URL) return responseJson(eventRaces());
      if (href === ENDURO_RACE_URL) return responseJson(racePayload());
      if (href === ENDURO_RESULTS_URL) return responseJson(resultsPayload(81001));
      if (href === UNSUPPORTED_RACE_URL) return responseJson(racePayload({ name: 'Youth race', modeName: 'Cross Country' }));
      if (href === UNSUPPORTED_RESULTS_URL) return responseJson(resultsPayload(81002));
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillLiveLapsArchive({
      archive,
      fetchImpl: upstream,
      sinceYear: 2024,
      currentDate: new Date('2024-03-12T00:00:00.000Z'),
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary).toMatchObject({
      discoveredPromoters: 1,
      discoveredEvents: 1,
      discoveredSourceRaces: 2,
      saved: 1,
      skipped: 0,
      skippedUnsupported: 1,
      failures: []
    });
    expect(archive.getCurrentSnapshot('livelaps:81001')).toMatchObject({
      capturedAt: '2024-03-12T00:00:00.000Z',
      sourceRace: { organizer: 'American National Enduro (ANEC)' }
    });
    expect(archive.getCurrentSnapshot('livelaps:81002')).toBeNull();
    db.close();
  });

  it('skips existing source races without refetching them and archives missing races', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    archive.saveSnapshot(
      {
        sourceRace: {
          provider: 'livelaps',
          sourceRaceId: '81001',
          canonicalUrl: 'https://www.livelaps.com/livelaps/race/81001',
          raceName: 'Existing National Enduro',
          modeName: 'Enduro',
          eventDate: '2024-03-10',
          location: null,
          organizer: 'American National Enduro (ANEC)'
        },
        normalized: { raceMeta: { raceName: 'Existing National Enduro', modeName: 'Enduro' }, allResults: [] },
        artifact: { mimeType: 'application/json', text: JSON.stringify({ race: {}, results: [] }) }
      },
      '2024-03-11T00:00:00.000Z'
    );
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === PROMOTER_EVENTS_URL) return responseJson(promoterEvents());
      if (href === EVENT_RACES_URL) return responseJson(eventRaces([81001, 81003]));
      if (href === ENDURO_RACE_URL) throw new Error('existing race should not be fetched');
      if (href === NEXT_RACE_URL) return responseJson(racePayload({ name: 'Next National Enduro' }));
      if (href === NEXT_RESULTS_URL) return responseJson(resultsPayload(81003));
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillLiveLapsArchive({
      archive,
      fetchImpl: upstream,
      sinceYear: 2024,
      currentDate: new Date('2024-03-12T00:00:00.000Z'),
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary).toMatchObject({ discoveredEvents: 1, saved: 1, skipped: 1, skippedUnsupported: 0, failures: [] });
    expect(archive.getCurrentSnapshot('livelaps:81001')?.capturedAt).toBe('2024-03-11T00:00:00.000Z');
    expect(archive.getCurrentSnapshot('livelaps:81003')).toMatchObject({
      capturedAt: '2024-03-12T00:00:00.000Z',
      sourceRace: { sourceRaceId: '81003' }
    });
    expect(upstream).not.toHaveBeenCalledWith(ENDURO_RACE_URL);
    db.close();
  });

  it('continues after a failed source race and reports the failure', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === PROMOTER_EVENTS_URL) return responseJson(promoterEvents());
      if (href === EVENT_RACES_URL) return responseJson(eventRaces([81001, 81003]));
      if (href === ENDURO_RACE_URL) return responseJson(racePayload());
      if (href === ENDURO_RESULTS_URL) return responseJson(resultsPayload(81001));
      if (href === NEXT_RACE_URL) return responseJson({ success: 0, message: 'not_found' }, 500);
      if (href === NEXT_RESULTS_URL) return responseJson(resultsPayload(81003));
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillLiveLapsArchive({
      archive,
      fetchImpl: upstream,
      sinceYear: 2024,
      currentDate: new Date('2024-03-12T00:00:00.000Z'),
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary.saved).toBe(1);
    expect(summary.failures).toEqual([
      expect.objectContaining({ sourceRaceId: '81003' })
    ]);
    expect(archive.getCurrentSnapshot('livelaps:81001')).not.toBeNull();
    db.close();
  });
});
