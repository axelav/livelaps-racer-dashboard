import type {
  ArchivedRace,
  ArchiveSearchResponse,
  RacerHistory,
  RacerSearchResponse,
  SourceRaceResponse
} from './domain.js';

export class ArchiveRequestError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ArchiveRequestError';
    this.status = status;
    this.details = details;
  }
}

function errorText(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const { error } = body as { error: unknown };
    return typeof error === 'string' ? error : null;
  }
  return null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ArchiveRequestError(
      errorText(body) ?? `Archive request failed with status ${response.status}.`,
      response.status,
      body
    );
  }

  return body as T;
}


export function archivedRaceFromResponse({ sourceRace, snapshot }: SourceRaceResponse): ArchivedRace {
  return {
    raceId: sourceRace.id,
    sourceRace,
    capturedAt: snapshot.capturedAt,
    snapshotId: snapshot.id,
    raceMeta: snapshot.raceMeta,
    allResults: snapshot.allResults
  };
}

export const archiveApi = {
  search: (query: string): Promise<ArchiveSearchResponse> => request(`/api/archive?q=${encodeURIComponent(query)}`),
  racers: (query: string): Promise<RacerSearchResponse> => request(`/api/racers?q=${encodeURIComponent(query)}`),
  ingest: (input: string): Promise<SourceRaceResponse> => request('/api/archive/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input })
  }),
  refresh: (id: string): Promise<SourceRaceResponse> => request(`/api/source-races/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }),
  sourceRace: (id: string): Promise<SourceRaceResponse> => request(`/api/source-races/${encodeURIComponent(id)}`),
  history: (normalizedName: string): Promise<RacerHistory> => request(`/api/history/${encodeURIComponent(normalizedName)}`)
};

export type ArchiveApi = typeof archiveApi;
