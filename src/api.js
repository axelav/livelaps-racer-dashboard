async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(body?.error ?? `Archive request failed with status ${response.status}.`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

function get(path) {
  return request(path);
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export function archivedRaceFromResponse({ sourceRace, snapshot }) {
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
  search: (query) => get(`/api/archive?q=${encodeURIComponent(query)}`),
  ingest: (input) => post('/api/archive/ingest', { input }),
  refresh: (id) => post(`/api/source-races/${encodeURIComponent(id)}/refresh`),
  sourceRace: (id) => get(`/api/source-races/${encodeURIComponent(id)}`),
  history: (normalizedName) => get(`/api/history/${encodeURIComponent(normalizedName)}`)
};
