// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { AXEL_ENTRY } from './fixtures/results.fixture.js';

const api = vi.hoisted(() => ({
  search: vi.fn(),
  ingest: vi.fn(),
  refresh: vi.fn(),
  sourceRace: vi.fn()
}));

vi.mock('../src/api.js', () => ({
  archiveApi: api,
  archivedRaceFromResponse: ({ sourceRace, snapshot }) => ({
    raceId: sourceRace.id,
    sourceRace,
    capturedAt: snapshot.capturedAt,
    snapshotId: snapshot.id,
    raceMeta: snapshot.raceMeta,
    allResults: snapshot.allResults
  })
}));

function archivedRace(allResults) {
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
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
});

it('loads or ingests the LiveLaps race preserved in a legacy results path', async () => {
  const missing = Object.assign(new Error('Archived source race not found.'), { status: 404 });
  api.sourceRace.mockRejectedValueOnce(missing);
  api.ingest.mockResolvedValueOnce(
    archivedRace([{ id: 1, fullName: 'Avery Rider', displayedNumber: '42' }])
  );
  history.replaceState({}, '', '/race/results/79103');

  await import('../src/main.js?legacy-path');

  await vi.waitFor(() => expect(api.ingest).toHaveBeenCalledWith('79103'));
  expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
  expect(document.querySelector('[data-slot="participantSection"]').hidden).toBe(false);
  expect(new URLSearchParams(location.search).get('race')).toBe('livelaps:79103');
});

it('canonicalizes a numeric race query before rendering its racer detail', async () => {
  api.sourceRace.mockResolvedValueOnce(archivedRace([AXEL_ENTRY]));
  history.replaceState({}, '', '/?race=79103&id=4758874');

  await import('../src/main.js?legacy-query');

  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="title"]')?.textContent).toContain('Axel Anderson')
  );
  expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
  expect(api.ingest).not.toHaveBeenCalled();
  expect(new URLSearchParams(location.search).get('race')).toBe('livelaps:79103');
  expect(new URLSearchParams(location.search).get('id')).toBe('4758874');
});
