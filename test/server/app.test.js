import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/archive/database.js';
import { normalizeRacerName } from '../../server/archive/history.js';
import { createArchive } from '../../server/archive/repository.js';
import { createLimiter } from '../../server/rate-limit.js';

function loadedRace({
  sourceRaceId = '79103',
  raceName = 'Summer Enduro',
  eventDate = '2026-07-12',
  fullName = 'Áxel-Anderson'
} = {}) {
  return {
    sourceRace: {
      provider: 'livelaps',
      sourceRaceId,
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${sourceRaceId}`,
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
          id: `${sourceRaceId}-1`,
          fullName,
          className: 'A 40+',
          overallPosition: 2,
          classPosition: 1,
          sections: []
        },
        {
          id: `${sourceRaceId}-2`,
          fullName: 'Other Racer',
          className: 'Pro',
          overallPosition: 1,
          classPosition: 1,
          sections: []
        }
      ]
    },
    artifact: { mimeType: 'application/json', text: '{"raw":true}' }
  };
}

function testLimiter(options) {
  return createLimiter({
    requester: { limit: 100, windowMs: 60_000 },
    sourceRace: { limit: 100, windowMs: 60_000 },
    ...options
  });
}

describe('archive API', () => {
  let db;
  let archive;
  let sources;
  let app;

  beforeEach(() => {
    db = openDatabase(':memory:');
    archive = createArchive(db);
    sources = {
      load: vi.fn(async (input) => loadedRace({ sourceRaceId: String(input).match(/\d+/)?.[0] })),
      refresh: vi.fn(async (sourceRace) => loadedRace({ sourceRaceId: sourceRace.sourceRaceId }))
    };
    app = createApp({ archive, sources, limiter: testLimiter() });
  });

  afterEach(() => {
    db.close();
  });

  it('ingests a supported race and returns its current normalized snapshot', async () => {
    const response = await request(app).post('/api/archive/ingest').send({ input: '79103' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sourceRace: { id: 'livelaps:79103', sourceRaceId: '79103' },
      snapshot: {
        capturedAt: expect.any(String),
        raceMeta: { raceName: 'Summer Enduro' }
      }
    });
    expect(response.body.snapshot.allResults).toHaveLength(2);
    expect(response.body.snapshot).not.toHaveProperty('artifact');
  });

  it('rejects unsupported hosts before invoking a source adapter', async () => {
    const response = await request(app)
      .post('/api/archive/ingest')
      .send({ input: 'https://example.com/race/79103' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Only supported LiveLaps and Moto-Tally race inputs can be archived.'
    });
    expect(sources.load).not.toHaveBeenCalled();
  });

  it('reads an archived source race without refreshing upstream', async () => {
    archive.saveSnapshot(loadedRace(), '2026-07-18T11:00:00.000Z');

    const response = await request(app).get('/api/source-races/livelaps%3A79103');

    expect(response.status).toBe(200);
    expect(response.body.snapshot).toMatchObject({
      capturedAt: '2026-07-18T11:00:00.000Z',
      allResults: expect.any(Array)
    });
    expect(sources.refresh).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown source race', async () => {
    const response = await request(app).get('/api/source-races/livelaps%3Aunknown');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Archived source race not found.' });
  });

  it('refreshes an archived source race and marks the response as refreshed', async () => {
    archive.saveSnapshot(loadedRace(), '2026-07-18T11:00:00.000Z');

    const response = await request(app).post('/api/source-races/livelaps%3A79103/refresh');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      refreshed: true,
      sourceRace: { id: 'livelaps:79103' },
      snapshot: { capturedAt: expect.any(String) }
    });
    expect(sources.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'livelaps:79103' })
    );
  });

  it('preserves and reports the current snapshot when an upstream refresh fails', async () => {
    archive.saveSnapshot(loadedRace(), '2026-07-18T11:00:00.000Z');
    sources.refresh.mockRejectedValueOnce(new Error('503'));
    const saveSnapshot = vi.spyOn(archive, 'saveSnapshot');

    const response = await request(app).post('/api/source-races/livelaps%3A79103/refresh');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: '503',
      currentSnapshot: {
        id: expect.any(Number),
        capturedAt: '2026-07-18T11:00:00.000Z'
      }
    });
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(archive.getCurrentSnapshot('livelaps:79103').capturedAt).toBe(
      '2026-07-18T11:00:00.000Z'
    );
  });

  it('rate-limits archive writes by requester', async () => {
    app = createApp({
      archive,
      sources,
      limiter: testLimiter({ requester: { limit: 1, windowMs: 60_000 } })
    });

    await request(app).post('/api/archive/ingest').send({ input: '79103' });
    const response = await request(app).post('/api/archive/ingest').send({ input: '79104' });

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(response.body).toEqual({ error: 'Rate limit exceeded for requester.' });
    expect(sources.load).toHaveBeenCalledTimes(1);
  });

  it('uses the forwarded requester IP behind the production reverse proxy', async () => {
    app = createApp({
      archive,
      sources,
      limiter: testLimiter({ requester: { limit: 1, windowMs: 60_000 } })
    });

    await request(app)
      .post('/api/archive/ingest')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ input: '79103' });
    const limited = await request(app)
      .post('/api/archive/ingest')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ input: '79104' });
    const otherRequester = await request(app)
      .post('/api/archive/ingest')
      .set('X-Forwarded-For', '198.51.100.11')
      .send({ input: '79105' });

    expect(limited.status).toBe(429);
    expect(otherRequester.status).toBe(201);
  });

  it('rate-limits archive writes by source race', async () => {
    app = createApp({
      archive,
      sources,
      limiter: testLimiter({ sourceRace: { limit: 1, windowMs: 60_000 } })
    });

    await request(app).post('/api/archive/ingest').send({ input: '79103' });
    const response = await request(app).post('/api/archive/ingest').send({ input: '79103' });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'Rate limit exceeded for source race.' });
    expect(sources.load).toHaveBeenCalledTimes(1);
  });

  it('searches the current archive catalog', async () => {
    archive.saveSnapshot(loadedRace(), '2026-07-18T11:00:00.000Z');
    archive.saveSnapshot(
      loadedRace({ sourceRaceId: '79104', raceName: 'Winter Enduro', eventDate: '2026-01-02' }),
      '2026-07-18T11:01:00.000Z'
    );

    const response = await request(app).get('/api/archive?q=summer');

    expect(response.status).toBe(200);
    expect(response.body.races).toMatchObject([
      { id: 'livelaps:79103', raceName: 'Summer Enduro' }
    ]);
  });

  it('returns history for the normalized racer name', async () => {
    archive.saveSnapshot(loadedRace(), '2026-07-18T11:00:00.000Z');

    const response = await request(app).get(
      `/api/history/${encodeURIComponent(normalizeRacerName('AXEL ANDERSON'))}`
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      racerName: 'Áxel-Anderson',
      races: [
        {
          sourceRaceId: 'livelaps:79103',
          normalizedName: 'axel anderson',
          fullName: 'Áxel-Anderson'
        }
      ],
      trends: {}
    });
  });
});
