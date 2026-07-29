// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHistory } from '../src/history.js';

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

describe('history dashboard', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('keeps the results ledger available in an on-demand dialog', () => {
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace: vi.fn()
    });

    expect(container.textContent).toContain('Overall percentile');
    expect(container.textContent).toContain('Class percentile');
    expect(container.querySelector('[data-slot="ledger"]')).toBeNull();

    const openLedger = container.querySelector('[data-slot="openLedger"]');
    expect(openLedger.textContent).toContain('View results ledger');
    expect(openLedger.textContent).toContain('2 results');

    openLedger.click();

    const dialog = container.querySelector('[data-slot="ledgerDialog"]');
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Results ledger');
    expect(dialog.textContent).toContain('2 / 45');
    expect(dialog.textContent).toContain('1 / 12');
    expect(dialog.textContent).toContain('2:00:34'); // time-scored race
    expect(dialog.textContent).toContain('50 pts'); // points-scored race

    // the viewed race is highlighted, not a link; the rest are links
    const selected = dialog.querySelector('[data-slot="ledgerRows"] tr.is-selected');
    expect(selected.textContent).toContain('Summer Enduro');
    expect(selected.querySelector('button')).toBeNull();
    expect(dialog.querySelectorAll('[data-slot="ledgerRows"] button')).toHaveLength(1);
  });

  it('selects a race when its ledger row is clicked, same as the picker', () => {
    const onSelectRace = vi.fn();
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace
    });

    container.querySelector('[data-slot="openLedger"]').click();
    const rows = container.querySelectorAll('[data-slot="ledgerRows"] tr');
    rows[1].querySelector('button').click();
    expect(onSelectRace).toHaveBeenCalledWith('mototally:ECEA/Enduro/2026/6/O1');
  });

  it('shows a safe empty state without rendering invalid trend charts', () => {
    renderHistory(container, {
      history: { racerName: 'Axel Anderson', races: [], trends: {} },
      selectedSourceRaceId: null,
      onSelectRace: vi.fn()
    });

    expect(container.textContent).toContain('No archived events yet.');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.innerHTML).not.toContain('NaN');
  });
});
