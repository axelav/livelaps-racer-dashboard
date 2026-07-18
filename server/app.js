import express from 'express';
import { normalizeRacerName } from './archive/history.js';
import { canonicalizeSourceInput } from './sources/input.js';

function snapshotResponse(current) {
  return {
    ...current.normalized,
    id: current.id,
    capturedAt: current.capturedAt
  };
}

function currentSnapshotMetadata(current) {
  return current ? { id: current.id, capturedAt: current.capturedAt } : undefined;
}

function sourceKey(source) {
  const providerId = source.sourceRaceId ?? `event:${source.eventId}`;
  return `${source.provider}:${providerId}`;
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function enforceRateLimit(limiter, req, res, sourceRace) {
  const result = limiter.consume({ requester: req.ip, sourceRace });
  if (result.allowed) return true;

  res.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  res.status(429).json({ error: `Rate limit exceeded for ${result.scope}.` });
  return false;
}

function sourceRaceResponse(current, extra = {}) {
  return {
    sourceRace: current.sourceRace,
    snapshot: snapshotResponse(current),
    ...extra
  };
}

export function createApp({ archive, sources, limiter }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.post('/api/archive/ingest', async (req, res) => {
    let canonicalSource;
    try {
      canonicalSource = canonicalizeSourceInput(req.body?.input);
    } catch (error) {
      return res.status(400).json({
        error: errorMessage(error, 'Invalid archive source input.')
      });
    }

    if (!enforceRateLimit(limiter, req, res, sourceKey(canonicalSource))) return;

    let loaded;
    try {
      loaded = await sources.load(req.body.input);
    } catch (error) {
      return res.status(503).json({
        error: errorMessage(error, 'The timing source could not be loaded.')
      });
    }

    try {
      const current = archive.saveSnapshot(loaded, new Date().toISOString());
      return res.status(201).json(sourceRaceResponse(current));
    } catch (error) {
      return res.status(500).json({
        error: errorMessage(error, 'The race snapshot could not be archived.')
      });
    }
  });

  app.post('/api/source-races/:id/refresh', async (req, res) => {
    const current = archive.getCurrentSnapshot(req.params.id);
    if (!current) return res.status(404).json({ error: 'Archived source race not found.' });
    if (!enforceRateLimit(limiter, req, res, current.sourceRace.id)) return;

    let loaded;
    try {
      loaded = await sources.refresh(current.sourceRace);
    } catch (error) {
      return res.status(503).json({
        error: errorMessage(error, 'The timing source could not be refreshed.'),
        currentSnapshot: currentSnapshotMetadata(current)
      });
    }

    try {
      const refreshed = archive.saveSnapshot(loaded, new Date().toISOString());
      return res.json(sourceRaceResponse(refreshed, { refreshed: true }));
    } catch (error) {
      return res.status(500).json({
        error: errorMessage(error, 'The refreshed snapshot could not be archived.'),
        currentSnapshot: currentSnapshotMetadata(archive.getCurrentSnapshot(req.params.id))
      });
    }
  });

  app.get('/api/source-races/:id', (req, res) => {
    const current = archive.getCurrentSnapshot(req.params.id);
    if (!current) return res.status(404).json({ error: 'Archived source race not found.' });
    return res.json(sourceRaceResponse(current));
  });

  app.get('/api/archive', (req, res) => {
    const races = archive.findCatalog({ query: String(req.query.q ?? '') });
    res.json({ races });
  });

  app.get('/api/history/:normalizedName', (req, res) => {
    const races = archive.findHistory(normalizeRacerName(req.params.normalizedName));
    res.json({ racerName: races[0]?.fullName ?? null, races, trends: {} });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    return res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}
