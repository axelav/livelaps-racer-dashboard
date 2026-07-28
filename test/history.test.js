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

  it('renders percentile trends and a chronological ledger with the current race highlighted', () => {
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace: vi.fn()
    });

    expect(container.textContent).toContain('Overall percentile');
    expect(container.textContent).toContain('Class percentile');
    expect(container.textContent).toContain('Results ledger');
    expect(container.textContent).toContain('2 / 45');
    expect(container.textContent).toContain('1 / 12');
    expect(container.textContent).toContain('2:00:34'); // time-scored race
    expect(container.textContent).toContain('50 pts'); // points-scored race

    // the viewed race is highlighted, not a link; the rest are links
    const selected = container.querySelector('[data-slot="ledger"] tr.is-selected');
    expect(selected.textContent).toContain('Summer Enduro');
    expect(selected.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('[data-slot="ledger"] button')).toHaveLength(1);
  });

  it('uses the shared history series colors from CSS variables', () => {
    container.style.setProperty('--series-overall', '#111111');
    container.style.setProperty('--series-class', '#222222');

    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace: vi.fn()
    });

    const trendCards = container.querySelectorAll('.history-trends [data-slot$="Trend"]');
    expect(trendCards[0].querySelector('path')?.getAttribute('stroke')).toBe('#111111');
    expect(trendCards[1].querySelector('path')?.getAttribute('stroke')).toBe('#222222');
  });

  it('selects a race when its ledger row is clicked, same as the picker', () => {
    const onSelectRace = vi.fn();
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace
    });

    const rows = container.querySelectorAll('[data-slot="ledger"] tr');
    rows[1].querySelector('button').click();
    expect(onSelectRace).toHaveBeenCalledWith('mototally:ECEA/Enduro/2026/6/O1');
  });

  it('opens a Comparison Rider picker with Shared Round suggestions and search', async () => {
    const onAddComparisonRider = vi.fn();
    const onSearchComparisonRiders = vi.fn(async () => [
      { normalizedName: 'cal chen', fullName: 'Cal Chen', sharedRoundCount: 1 }
    ]);
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace: vi.fn(),
      comparisonCandidates: [
        { normalizedName: 'bea brown', fullName: 'Bea Brown', sharedRoundCount: 2 }
      ],
      onAddComparisonRider,
      onSearchComparisonRiders
    });

    container.querySelector('[data-slot="comparisonToggle"]').click();
    expect(container.textContent).toContain('Bea Brown');
    expect(container.textContent).toContain('2 shared rounds');

    container.querySelector('[data-candidate="bea brown"]').click();
    expect(onAddComparisonRider).toHaveBeenCalledWith('bea brown');

    const input = container.querySelector('[data-slot="comparisonSearch"]');
    input.value = 'cal';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(onSearchComparisonRiders).toHaveBeenCalledWith('cal'));
    await vi.waitFor(() => expect(container.textContent).toContain('Cal Chen'));
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
