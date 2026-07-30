// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { AXEL_ENTRY } from './fixtures/results.fixture.js';
import { mustQuery } from './dom-helpers.js';

type ArchivedRaceResponse = {
  sourceRace: {
    id: string;
    provider: string;
    sourceRaceId: string;
    raceName: string;
  };
  snapshot: {
    id: number;
    capturedAt: string;
    raceMeta: { raceName: string };
    allResults: unknown[];
  };
};

function ledgerRaceLink(label: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('.ledger-race-link')).find(
    (link) => link.textContent === label
  );
}

const ArchiveRequestError = vi.hoisted(() =>
  class ArchiveRequestError extends Error {
    status: number;
    details: unknown;

    constructor(message: string, status: number, details: unknown = null) {
      super(message);
      this.name = 'ArchiveRequestError';
      this.status = status;
      this.details = details;
    }
  }
);

const api = vi.hoisted(() => ({
  search: vi.fn(),
  ingest: vi.fn(),
  refresh: vi.fn(),
  sourceRace: vi.fn(),
  history: vi.fn()
}));

vi.mock('../src/api.js', () => ({
  ArchiveRequestError,
  archiveApi: api,
  archivedRaceFromResponse: ({ sourceRace, snapshot }: ArchivedRaceResponse) => ({
    raceId: sourceRace.id,
    sourceRace,
    capturedAt: snapshot.capturedAt,
    snapshotId: snapshot.id,
    raceMeta: snapshot.raceMeta,
    allResults: snapshot.allResults
  })
}));

function archivedRace(allResults: unknown[]): ArchivedRaceResponse {
  return {
    sourceRace: {
      id: 'livelaps:79103',
      provider: 'livelaps',
      sourceRaceId: '79103',
      raceName: 'Test Enduro'
    },
    snapshot: {
      id: 1,
      capturedAt: '2026-07-18T11:00:00.000Z',
      raceMeta: { raceName: 'Test Enduro' },
      allResults
    }
  };
}

beforeEach(() => {
  vi.resetModules();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.search.mockResolvedValue({ races: [] });
  api.history.mockResolvedValue({
    racerName: 'Axel Anderson',
    races: [],
    trends: { overallPercentiles: [], classPercentiles: [] }
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
});

it('loads or ingests the LiveLaps race preserved in a legacy results path', async () => {
  const missing = new ArchiveRequestError('Archived source race not found.', 404);
  api.sourceRace.mockRejectedValueOnce(missing);
  api.ingest.mockResolvedValueOnce(
    archivedRace([{ id: 1, fullName: 'Avery Rider', displayedNumber: '42' }])
  );
  history.replaceState({}, '', '/race/results/79103');

  await import('../src/main.ts?legacy-path');

  await vi.waitFor(() => expect(api.ingest).toHaveBeenCalledWith('79103'));
  expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
  expect(mustQuery<HTMLElement>(document, '[data-slot="participantSection"]').hidden).toBe(false);
  expect(new URLSearchParams(location.search).get('race')).toBe('livelaps:79103');
});

it('canonicalizes a numeric race query before rendering its racer detail', async () => {
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY]));
  history.replaceState({}, '', '/?race=79103&id=4758874');

  await import('../src/main.ts?legacy-query');

  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="title"]')?.textContent).toContain('Axel Anderson')
  );
  expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
  expect(api.ingest).not.toHaveBeenCalled();
  expect(new URLSearchParams(location.search).get('race')).toBe('livelaps:79103');
  expect(new URLSearchParams(location.search).get('id')).toBe('4758874');
});

it('loads all archived history for the selected racer without changing race detail', async () => {
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY]));
  api.history.mockResolvedValueOnce({
    racerName: 'Axel Anderson',
    races: [
      {
        sourceRaceId: 'livelaps:79103',
        raceName: 'Test Enduro',
        eventDate: '2026-07-12',
        eventDateProvenance: 'source',
        provider: 'livelaps',
        overallPosition: 2,
        fieldSize: 45,
        overallPercentile: 98,
        classPosition: 1,
        classSize: 12,
        classPercentile: 100,
        totalTimeSeconds: 7200
      }
    ],
    trends: { overallPercentiles: [98], classPercentiles: [100] }
  });
  history.replaceState({}, '', '/?race=livelaps%3A79103&id=4758874');

  await import('../src/main.ts?history-dashboard');

  await vi.waitFor(() => expect(api.history).toHaveBeenCalledWith('axel anderson'));
  expect(mustQuery<HTMLElement>(document, '[data-slot="historyPanel"]').textContent).toContain(
    'History dashboard'
  );
  expect(mustQuery<HTMLElement>(document, '[data-slot="historyPanel"]').closest('.viz-root')).not.toBeNull();
});

it('changes only race detail when a history race is selected', async () => {
  const motoRace = {
    ...archivedRace([AXEL_ENTRY]),
    sourceRace: {
      id: 'mototally:ECEA/Enduro/2026/6/O1',
      provider: 'mototally',
      sourceRaceId: 'ECEA/Enduro/2026/6/O1',
      raceName: 'Pine Barrens'
    },
    snapshot: {
      ...archivedRace([AXEL_ENTRY]).snapshot,
      raceMeta: { raceName: 'Pine Barrens' }
    }
  };
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY])).mockResolvedValueOnce(motoRace);
  api.history.mockResolvedValueOnce({
    racerName: 'Axel Anderson',
    races: [
      {
        sourceRaceId: 'livelaps:79103', raceName: 'Test Enduro', eventDate: '2026-07-12',
        eventDateProvenance: 'source', provider: 'livelaps', overallPosition: 2, fieldSize: 45,
        overallPercentile: 98, classPosition: 1, classSize: 12, classPercentile: 100, totalTimeSeconds: 7200
      },
      {
        sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1', raceName: 'Pine Barrens', eventDate: '2026-07-19',
        eventDateProvenance: 'source', provider: 'mototally', overallPosition: 4, fieldSize: 40,
        overallPercentile: 92, classPosition: 2, classSize: 10, classPercentile: 90, totalTimeSeconds: 7300
      }
    ],
    trends: { overallPercentiles: [98, 92], classPercentiles: [100, 90] }
  });
  history.replaceState({}, '', '/?race=livelaps%3A79103&id=4758874');

  await import('../src/main.ts?history-picker');
  await vi.waitFor(() => expect(ledgerRaceLink('Pine Barrens')).toBeTruthy());
  const pineBarrens = ledgerRaceLink('Pine Barrens');
  if (!pineBarrens) throw new Error('Expected Pine Barrens ledger link');
  pineBarrens.click();

  await vi.waitFor(() => expect(api.sourceRace).toHaveBeenCalledWith('mototally:ECEA/Enduro/2026/6/O1'));
  expect(api.history).toHaveBeenCalledTimes(1);
  expect(mustQuery<HTMLElement>(document, '[data-slot="title"]').textContent).toContain('Axel Anderson');
});

it('keeps selected race detail visible when history loading fails', async () => {
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY]));
  api.history.mockRejectedValueOnce(new Error('History service unavailable'));
  history.replaceState({}, '', '/?race=livelaps%3A79103&id=4758874');

  await import('../src/main.ts?history-failure');

  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="title"]')?.textContent).toContain('Axel Anderson')
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="historyPanel"]')?.textContent).toContain(
      'History is unavailable'
    )
  );
});

it('does not let an older picker load overwrite a later back navigation', async () => {
  let resolveRace: (race: ArchivedRaceResponse) => void = () => {};
  const pendingRace = new Promise<ArchivedRaceResponse>((resolve) => {
    resolveRace = resolve;
  });
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY])).mockReturnValueOnce(pendingRace);
  api.history.mockResolvedValueOnce({
    racerName: 'Axel Anderson',
    races: [
      {
        sourceRaceId: 'livelaps:79103', raceName: 'Test Enduro', eventDate: '2026-07-12',
        eventDateProvenance: 'source', provider: 'livelaps', overallPosition: 2, fieldSize: 45,
        overallPercentile: 98, classPosition: 1, classSize: 12, classPercentile: 100, totalTimeSeconds: 7200
      },
      {
        sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1', raceName: 'Pine Barrens', eventDate: '2026-07-19',
        eventDateProvenance: 'source', provider: 'mototally', overallPosition: 4, fieldSize: 40,
        overallPercentile: 92, classPosition: 2, classSize: 10, classPercentile: 90, totalTimeSeconds: 7300
      }
    ],
    trends: { overallPercentiles: [98, 92], classPercentiles: [100, 90] }
  });
  history.replaceState({}, '', '/?race=livelaps%3A79103&id=4758874');

  await import('../src/main.ts?stale-picker');
  await vi.waitFor(() => expect(ledgerRaceLink('Pine Barrens')).toBeTruthy());
  const pineBarrens = ledgerRaceLink('Pine Barrens');
  if (!pineBarrens) throw new Error('Expected Pine Barrens ledger link');
  pineBarrens.click();
  mustQuery<HTMLButtonElement>(document, '[data-slot="home"]').click();
  resolveRace(archivedRace([AXEL_ENTRY]));

  await vi.waitFor(() => expect(mustQuery<HTMLElement>(document, '[data-slot="participantSection"]')).not.toBeNull());
  expect(document.querySelector('[data-slot="title"]')).toBeNull();
});
