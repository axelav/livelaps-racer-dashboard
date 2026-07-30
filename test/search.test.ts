// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AXEL_ENTRY } from './fixtures/results.fixture.js';
import { renderDashboard } from '../src/dashboard.js';
import { renderSearch } from '../src/search.js';
import * as raceSource from '../src/raceSource.js';
import { asInput, mustQuery } from './dom-helpers.js';
import type { ArchivedRace, RaceEntry, SourceRace, SourceRaceResponse } from '../src/domain.js';

const sourceRace = {
  id: 'livelaps:79103',
  provider: 'livelaps',
  sourceRaceId: '79103',
  canonicalUrl: 'https://www.livelaps.com/livelaps/race/79103',
  raceName: 'Test Enduro',
  modeName: 'Overall',
  eventDate: null,
  location: null,
  organizer: null
} satisfies SourceRace & { id: string };

const allResults = [
  {
    id: 1,
    fullName: 'Avery Rider',
    displayedNumber: '42',
    brand: null,
    className: null,
    overallPosition: null,
    classPosition: null
  },
  {
    id: 2,
    fullName: 'Blake Racer',
    displayedNumber: '8',
    brand: null,
    className: null,
    overallPosition: null,
    classPosition: null
  }
] satisfies RaceEntry[];

const race = {
  raceId: '79103',
  sourceRace,
  capturedAt: '2026-07-18T11:00:00.000Z',
  snapshotId: 1,
  raceMeta: { raceName: 'Test Enduro', modeName: 'Overall' },
  allResults
} satisfies ArchivedRace;

const archivedRace = {
  sourceRace,
  snapshot: {
    id: 1,
    capturedAt: '2026-07-18T11:00:00.000Z',
    raceMeta: race.raceMeta,
    allResults
  }
} satisfies SourceRaceResponse;

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
    mustQuery<HTMLButtonElement>(container, '[data-slot="archiveList"] button').click();

    await vi.waitFor(() =>
      expect(mustQuery<HTMLElement>(container, '[data-slot="participantSection"]').hidden).toBe(false)
    );
    expect(api.sourceRace).toHaveBeenCalledWith('livelaps:79103');
    expect(providerLookup).not.toHaveBeenCalled();
  });

  it('searches riders as you type and reports selections', async () => {
    const container = document.createElement('div');
    const api = {
      search: vi.fn().mockResolvedValue({ races: [] }),
      racers: vi
        .fn()
        .mockResolvedValue({ racers: [{ normalizedName: 'donovan marvin', fullName: 'DONOVAN MARVIN', raceCount: 7 }] }),
      sourceRace: vi.fn(),
      ingest: vi.fn()
    };
    const onSelectRacer = vi.fn();

    renderSearch(container, { api, onSelect: vi.fn(), onSelectRacer, debounceMs: 0 });

    const input = asInput(mustQuery(container, '[data-slot="racerSearchInput"]'));
    input.value = 'marv';
    input.dispatchEvent(new Event('input'));

    await vi.waitFor(() => expect(api.racers).toHaveBeenCalledWith('marv'));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-slot="racerSearchList"] button')).not.toBeNull()
    );
    const button = mustQuery<HTMLButtonElement>(container, '[data-slot="racerSearchList"] button');
    expect(button.textContent).toBe('DONOVAN MARVIN · 7 races');
    button.click();
    expect(onSelectRacer).toHaveBeenCalledWith('donovan marvin', 'DONOVAN MARVIN');
  });

  it('filters the race catalog as you type without a submit', async () => {
    const container = document.createElement('div');
    const api = {
      search: vi.fn().mockResolvedValue({ races: [archivedRace.sourceRace] }),
      racers: vi.fn().mockResolvedValue({ racers: [] }),
      sourceRace: vi.fn(),
      ingest: vi.fn()
    };

    renderSearch(container, { api, onSelect: vi.fn(), debounceMs: 0 });
    await vi.waitFor(() => expect(api.search).toHaveBeenCalledWith(''));

    const input = asInput(mustQuery(container, '[data-slot="raceInput"]'));
    input.value = 'foggy';
    input.dispatchEvent(new Event('input'));

    await vi.waitFor(() => expect(api.search).toHaveBeenCalledWith('foggy'));
    // no search button exists anymore
    expect(container.querySelector('[data-slot="raceForm"] button')).toBeNull();
  });

  it('ingests a submitted new race URL through the archive API', async () => {
    const container = document.createElement('div');
    const api = {
      search: vi.fn().mockResolvedValue({ races: [] }),
      sourceRace: vi.fn(),
      ingest: vi.fn().mockResolvedValue(archivedRace)
    };

    renderSearch(container, { api, onSelect: vi.fn() });
    mustQuery<HTMLButtonElement>(container, '[data-slot="showIngest"]').click();
    const input = asInput(mustQuery(container, '[data-slot="ingestInput"]'));
    input.value = 'https://www.livelaps.com/livelaps/race/79103';
    mustQuery<HTMLFormElement>(container, '[data-slot="ingestForm"]').dispatchEvent(new Event('submit'));

    await vi.waitFor(() =>
      expect(api.ingest).toHaveBeenCalledWith('https://www.livelaps.com/livelaps/race/79103')
    );
    expect(mustQuery<HTMLElement>(container, '[data-slot="participantSection"]').hidden).toBe(false);
  });
});

describe('archived race dashboard', () => {
  it('keeps the current results visible and shows a notice when refresh fails', async () => {
    const container = document.createElement('div');
    const onRefresh = vi.fn().mockRejectedValue(new Error('Unable to refresh the timing source.'));

    renderDashboard(container, {
      raceMeta: { raceName: 'Test Enduro', modeName: 'Overall' },
      racer: AXEL_ENTRY,
      fieldSize: 300,
      classSize: 20,
      capturedAt: '2026-07-18T11:00:00.000Z',
      onRefresh
    });
    mustQuery<HTMLButtonElement>(container, '[data-slot="refresh"]').click();

    await vi.waitFor(() =>
      expect(mustQuery<HTMLElement>(container, '[data-slot="refreshNotice"]').hidden).toBe(false)
    );
    expect(mustQuery<HTMLElement>(container, '[data-slot="title"]').textContent).toContain('Axel Anderson');
    expect(mustQuery<HTMLElement>(container, '[data-slot="refreshNotice"]').textContent).toContain(
      'Unable to refresh the timing source.'
    );
  });
});

describe('renderSearch with an already loaded race', () => {
  it('keeps race data available for selecting another racer without a new lookup', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderSearch(container, { race, onSelect });

    expect(mustQuery<HTMLElement>(container, '[data-slot="raceForm"]').hidden).toBe(true);
    expect(mustQuery<HTMLElement>(container, '[data-slot="participantSection"]').hidden).toBe(false);

    const participantInput = asInput(mustQuery(container, '[data-slot="participantInput"]'));
    participantInput.value = '42';
    participantInput.dispatchEvent(new Event('input'));
    mustQuery<HTMLButtonElement>(container, '.participant-list button').click();

    expect(onSelect).toHaveBeenCalledWith('79103', 1, race);
  });

  it('requires an explicit action before showing the race replacement form', () => {
    const container = document.createElement('div');
    const api = { search: vi.fn().mockResolvedValue({ races: [] }) };

    renderSearch(container, { race, onSelect: vi.fn(), api });
    mustQuery<HTMLButtonElement>(container, '[data-slot="changeRace"]').click();

    expect(mustQuery<HTMLElement>(container, '[data-slot="raceForm"]').hidden).toBe(false);
    expect(mustQuery<HTMLElement>(container, '[data-slot="changeRace"]').hidden).toBe(true);
  });
});
