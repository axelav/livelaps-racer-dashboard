// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSavedRacerName,
  loadSavedRacerName,
  renderHistory,
  saveRacerName
} from '../src/history.js';

const history = {
  racerName: 'Áxel Anderson',
  races: [
    {
      sourceRaceId: 'livelaps:79103',
      raceName: 'Summer Enduro',
      eventDate: '2026-07-12',
      eventDateProvenance: 'source',
      provider: 'livelaps',
      overallPosition: 2,
      fieldSize: 45,
      overallPercentile: 98,
      classPosition: 1,
      classSize: 12,
      classPercentile: 100,
      totalTimeSeconds: 7234
    },
    {
      sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1',
      raceName: 'Pine Barrens',
      eventDate: '2026-07-19',
      eventDateProvenance: 'source',
      provider: 'mototally',
      overallPosition: 10,
      fieldSize: 44,
      overallPercentile: 80,
      classPosition: 3,
      classSize: 10,
      classPercentile: 80,
      totalTimeSeconds: null,
      totalPoints: 50
    }
  ],
  trends: { overallPercentiles: [98, 80], classPercentiles: [100, 80] }
};

describe('racer preference', () => {
  beforeEach(() => localStorage.clear());

  it('saves, loads, and clears only the viewed racer name', () => {
    const storage = new Map();
    const fakeStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    };

    saveRacerName('axel anderson', fakeStorage);
    expect(loadSavedRacerName(fakeStorage)).toBe('axel anderson');

    clearSavedRacerName(fakeStorage);
    expect(loadSavedRacerName(fakeStorage)).toBeNull();
  });
});

describe('history dashboard', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders percentile trends, chronological ledger, and a race detail picker', () => {
    const onSelectRace = vi.fn();
    const onClear = vi.fn();

    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace,
      onClear
    });

    expect(container.textContent).toContain('Overall percentile');
    expect(container.textContent).toContain('Class percentile');
    expect(container.textContent).toContain('Results ledger');
    expect(container.textContent).toContain('2 / 45');
    expect(container.textContent).toContain('1 / 12');
    expect(container.textContent).toContain('2:00:34'); // time-scored race
    expect(container.textContent).toContain('50 pts'); // points-scored race

    const picker = container.querySelector('[data-slot="racePicker"]');
    expect(picker.value).toBe('livelaps:79103');
    picker.value = 'mototally:ECEA/Enduro/2026/6/O1';
    picker.dispatchEvent(new Event('change'));
    expect(onSelectRace).toHaveBeenCalledWith('mototally:ECEA/Enduro/2026/6/O1');

    container.querySelector('[data-slot="clearHistory"]').click();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('keeps trend and ledger data stable when the detail picker changes', () => {
    const onSelectRace = vi.fn();
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace,
      onClear: vi.fn()
    });
    const before = container.querySelector('[data-slot="historyData"]').textContent;

    const picker = container.querySelector('[data-slot="racePicker"]');
    picker.value = 'mototally:ECEA/Enduro/2026/6/O1';
    picker.dispatchEvent(new Event('change'));

    expect(container.querySelector('[data-slot="historyData"]').textContent).toBe(before);
  });

  it('shows a safe empty state without rendering invalid trend charts', () => {
    renderHistory(container, {
      history: { racerName: 'Axel Anderson', races: [], trends: {} },
      selectedSourceRaceId: null,
      onSelectRace: vi.fn(),
      onClear: vi.fn()
    });

    expect(container.textContent).toContain('No archived events yet.');
    expect(container.querySelector('[data-slot="racePicker"]').disabled).toBe(true);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.innerHTML).not.toContain('NaN');
  });
});
