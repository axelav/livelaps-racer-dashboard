// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AXEL_ENTRY } from './fixtures/results.fixture.js';
import { renderDashboard } from '../src/dashboard.js';
import { renderSearch } from '../src/search.js';
import * as raceSource from '../src/raceSource.js';

const race = {
  raceId: '79103',
  raceMeta: { raceName: 'Test Enduro' },
  allResults: [
    { id: 1, fullName: 'Avery Rider', displayedNumber: '42' },
    { id: 2, fullName: 'Blake Racer', displayedNumber: '8' }
  ]
};

const archivedRace = {
  sourceRace: {
    id: 'livelaps:79103',
    provider: 'livelaps',
    sourceRaceId: '79103',
    raceName: 'Test Enduro'
  },
  snapshot: {
    capturedAt: '2026-07-18T11:00:00.000Z',
    raceMeta: { raceName: 'Test Enduro' },
    allResults: race.allResults
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('archive-first race search', () => {
  it('loads a known archived race through the archive API without calling a provider', async () => {
    const container = document.createElement('div');
    const api = {
      search: vi.fn().mockResolvedValue({ races: [archivedRace.sourceRace] }),
      sourceRace: vi.fn().mockResolvedValue(archivedRace),
      ingest: vi.fn()
    };
    const providerLookup = vi.spyOn(raceSource, 'resolveAndLoadRace');

    renderSearch(container, { api, onSelect: vi.fn() });

    await vi.waitFor(() =>
      expect(container.querySelector('[data-slot="archiveList"] button')).not.toBeNull()
    );
    container.querySelector('[data-slot="archiveList"] button').click();

    await vi.waitFor(() =>
      expect(container.querySelector('[data-slot="participantSection"]').hidden).toBe(false)
    );
    expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
    expect(providerLookup).not.toHaveBeenCalled();
  });

  it('ingests a submitted new race URL through the archive API', async () => {
    const container = document.createElement('div');
    const api = {
      search: vi.fn().mockResolvedValue({ races: [] }),
      sourceRace: vi.fn(),
      ingest: vi.fn().mockResolvedValue(archivedRace)
    };

    renderSearch(container, { api, onSelect: vi.fn() });
    container.querySelector('[data-slot="showIngest"]').click();
    const input = container.querySelector('[data-slot="ingestInput"]');
    input.value = 'https://www.livelaps.com/livelaps/race/79103';
    container.querySelector('[data-slot="ingestForm"]').dispatchEvent(new Event('submit'));

    await vi.waitFor(() =>
      expect(api.ingest).toHaveBeenCalledWith('https://www.livelaps.com/livelaps/race/79103')
    );
    expect(container.querySelector('[data-slot="participantSection"]').hidden).toBe(false);
  });
});

describe('archived race dashboard', () => {
  it('keeps the current results visible and shows a notice when refresh fails', async () => {
    const container = document.createElement('div');
    const onRefresh = vi.fn().mockRejectedValue(new Error('Unable to refresh the timing source.'));

    renderDashboard(container, {
      raceMeta: { raceName: 'Test Enduro' },
      racer: AXEL_ENTRY,
      fieldSize: 300,
      classSize: 20,
      capturedAt: '2026-07-18T11:00:00.000Z',
      onBack: vi.fn(),
      onRefresh
    });
    container.querySelector('[data-slot="refresh"]').click();

    await vi.waitFor(() =>
      expect(container.querySelector('[data-slot="refreshNotice"]').hidden).toBe(false)
    );
    expect(container.querySelector('[data-slot="title"]').textContent).toContain('Axel Anderson');
    expect(container.querySelector('[data-slot="refreshNotice"]').textContent).toContain(
      'Unable to refresh the timing source.'
    );
  });
});

describe('renderSearch with an already loaded race', () => {
  it('keeps race data available for selecting another racer without a new lookup', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderSearch(container, { race, onSelect });

    expect(container.querySelector('[data-slot="raceForm"]').hidden).toBe(true);
    expect(container.querySelector('[data-slot="participantSection"]').hidden).toBe(false);

    const participantInput = container.querySelector('[data-slot="participantInput"]');
    participantInput.value = '42';
    participantInput.dispatchEvent(new Event('input'));
    container.querySelector('.participant-list button').click();

    expect(onSelect).toHaveBeenCalledWith('79103', 1, race);
  });

  it('requires an explicit action before showing the race replacement form', () => {
    const container = document.createElement('div');
    const api = { search: vi.fn().mockResolvedValue({ races: [] }) };

    renderSearch(container, { race, onSelect: vi.fn(), api });
    container.querySelector('[data-slot="changeRace"]').click();

    expect(container.querySelector('[data-slot="raceForm"]').hidden).toBe(false);
    expect(container.querySelector('[data-slot="changeRace"]').hidden).toBe(true);
  });
});
