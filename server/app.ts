import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Snapshot, SourceRace } from '../src/domain.js';
import { buildRacerHistory, normalizeRacerName } from './archive/history.js';
import type { ArchiveRepository } from './archive/repository.js';
import { createRequesterId, type RequesterId } from './requester-id.js';
import type { RateLimiter, RateLimitKeys } from './rate-limit.js';
import { canonicalizeSourceInput, type CanonicalSourceInput } from './sources/input.js';

type ArchiveInputRace = Parameters<ArchiveRepository['saveSnapshot']>[0];

type AppSources = {
  load(input: unknown): Promise<ArchiveInputRace>;
  refresh(sourceRace: SourceRace & { id: string }): Promise<ArchiveInputRace>;
};

type CreateAppOptions = {
  archive: ArchiveRepository;
  sources: AppSources;
  limiter: RateLimiter;
  trustedProxyIps?: readonly string[];
  requesterId?: RequesterId;
};

type SnapshotResponse = Snapshot['normalized'] & {
  id: Snapshot['id'];
  capturedAt: string;
};

type SourceRaceResponse = {
  sourceRace: Snapshot['sourceRace'];
  snapshot: SnapshotResponse;
};

function snapshotResponse(current: Snapshot): SnapshotResponse {
  return {
    ...current.normalized,
    id: current.id,
    capturedAt: current.capturedAt
  };
}

function currentSnapshotMetadata(current: Snapshot | null): { id: Snapshot['id']; capturedAt: string } | undefined {
  return current ? { id: current.id, capturedAt: current.capturedAt } : undefined;
}

function sourceRaceKey(sourceRace: Pick<SourceRace, 'provider' | 'sourceRaceId'>): string {
  return `${sourceRace.provider}:${sourceRace.sourceRaceId}`;
}

function sourceInputRateLimitKey(source: CanonicalSourceInput): string {
  // Moto-Tally class and overall result URLs for a round resolve to one
  // archived overall result. The group is not a stable source-race identity
  // until that page is loaded, so protect the round before fetching it.
  if (source.provider === 'mototally') {
    return `${source.provider}:${source.sourceRaceId.split('/').slice(0, 4).join('/')}`;
  }
  if (source.inputKind === 'race') return sourceRaceKey(source);
  return `${source.provider}:event:${source.eventId}`;
}

function enforceRateLimit(limiter: RateLimiter, res: Response, keys: RateLimitKeys): boolean {
  const result = limiter.consume(keys);
  if (result.allowed) return true;

  res.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  res.status(429).json({ error: `Rate limit exceeded for ${result.scope}.` });
  return false;
}

function sourceRaceResponse<TExtra extends Record<string, unknown> = Record<string, never>>(
  current: Snapshot,
  extra = {} as TExtra
): SourceRaceResponse & TExtra {
  return {
    sourceRace: current.sourceRace,
    snapshot: snapshotResponse(current),
    ...extra
  };
}

function requestInput(body: unknown): unknown {
  if (typeof body !== 'object' || body == null || !('input' in body)) return undefined;
  return body.input;
}

function isJsonSyntaxError(error: unknown): error is SyntaxError & { status: number } {
  if (!(error instanceof SyntaxError) || !('status' in error)) return false;
  return typeof error.status === 'number' && error.status === 400;
}

export function createApp({
  archive,
  sources,
  limiter,
  trustedProxyIps,
  requesterId = trustedProxyIps === undefined ? createRequesterId() : createRequesterId({ trustedProxyIps })
}: CreateAppOptions): Express {
  const app = express();
  app.use(express.json());

  app.post('/api/archive/ingest', async (req: Request, res: Response): Promise<void> => {
    const input = requestInput(req.body);
    let canonicalSource: CanonicalSourceInput;
    try {
      canonicalSource = canonicalizeSourceInput(input);
    } catch {
      res.status(400).json({
        error: 'Only supported LiveLaps and Moto-Tally race inputs can be archived.'
      });
      return;
    }

    // Race IDs are known before loading, so reject a saturated source bucket
    // before it can trigger another upstream request. Event links resolve to a
    // race only upstream; their stable event ID is used as a separate bucket
    // to give the same no-repeat protection without guessing a race identity.
    if (
      !enforceRateLimit(limiter, res, {
        requester: requesterId(req),
        sourceRace: sourceInputRateLimitKey(canonicalSource)
      })
    ) {
      return;
    }

    let loaded: ArchiveInputRace;
    try {
      loaded = await sources.load(input);
    } catch (error) {
      console.error('Archive API ingest load failed.', error);
      res.status(503).json({ error: 'Unable to load the timing source.' });
      return;
    }

    try {
      const current = archive.saveSnapshot(loaded, new Date().toISOString());
      res.status(201).json(sourceRaceResponse(current));
    } catch (error) {
      console.error('Archive API ingest persistence failed.', error);
      res.status(500).json({ error: 'Unable to archive the race snapshot.' });
    }
  });

  app.post('/api/source-races/:id/refresh', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const current = archive.getCurrentSnapshot(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Archived source race not found.' });
      return;
    }
    if (
      !enforceRateLimit(limiter, res, {
        requester: requesterId(req),
        sourceRace: current.sourceRace.id
      })
    ) {
      return;
    }

    let loaded: ArchiveInputRace;
    try {
      loaded = await sources.refresh(current.sourceRace);
    } catch (error) {
      console.error('Archive API refresh load failed.', error);
      res.status(503).json({
        error: 'Unable to refresh the timing source.',
        currentSnapshot: currentSnapshotMetadata(current)
      });
      return;
    }

    try {
      const refreshed = archive.saveSnapshot(loaded, new Date().toISOString());
      res.json(sourceRaceResponse(refreshed, { refreshed: true }));
    } catch (error) {
      console.error('Archive API refresh persistence failed.', error);
      res.status(500).json({
        error: 'Unable to archive the refreshed snapshot.',
        currentSnapshot: currentSnapshotMetadata(archive.getCurrentSnapshot(req.params.id))
      });
    }
  });

  app.get('/api/source-races/:id', (req: Request<{ id: string }>, res: Response): void => {
    const current = archive.getCurrentSnapshot(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Archived source race not found.' });
      return;
    }
    res.json(sourceRaceResponse(current));
  });

  app.get('/api/archive', (req: Request, res: Response): void => {
    const races = archive.findCatalog({ query: String(req.query.q ?? '') });
    res.json({ races });
  });

  app.get('/api/racers', (req: Request, res: Response): void => {
    res.json({ racers: archive.findRacers(String(req.query.q ?? '')) });
  });

  app.get('/api/history/:normalizedName', (req: Request<{ normalizedName: string }>, res: Response): void => {
    const entries = archive.findHistory(normalizeRacerName(req.params.normalizedName));
    res.json(buildRacerHistory(entries));
  });

  app.use('/api', (_req: Request, res: Response): void => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (isJsonSyntaxError(error)) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    console.error('Archive API unexpected error.', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}
