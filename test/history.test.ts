// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHistory } from '../src/history.js';
import { mustQuery, mustQueryAll } from './dom-helpers.js';
import type { RacerHistory } from '../src/domain.js';

const history = {
  racerName: 'Áxel Anderson',
  races: [
    {
      sourceRaceId: 'livelaps:79103',
      raceName: 'Summer Enduro',
      eventDate: '2026-07-12',
      eventDateProvenance: 'source',
      provider: 'livelaps',
      fullName: 'Áxel Anderson',
      overallPosition: 2,
      fieldSize: 45,
      overallPercentile: 98,
      classPosition: 1,
      classSize: 12,
      classPercentile: 100,
      totalTimeSeconds: 7234,
      totalPoints: null,
      resultStatus: 'finished',
      resultNote: null
    },
    {
      sourceRaceId: 'mototally:ECEA/Enduro/2026/6/O1',
      raceName: 'Pine Barrens',
      eventDate: '2026-07-19',
      eventDateProvenance: 'source',
      provider: 'mototally',
      fullName: 'Áxel Anderson',
      overallPosition: 10,
      fieldSize: 44,
      overallPercentile: 80,
      classPosition: 3,
      classSize: 10,
      classPercentile: 80,
      totalTimeSeconds: null,
      totalPoints: 50,
      resultStatus: 'finished',
      resultNote: null
    }
  ],
  trends: { overallPercentiles: [98, 80], classPercentiles: [100, 80] }
} satisfies RacerHistory;

describe('history dashboard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('keeps the results ledger available in an on-demand dialog', () => {
    renderHistory(container, {
      history,
      selectedSourceRaceId: 'livelaps:79103',
      onSelectRace: vi.fn()
    });

    expect(container.textContent).toContain('Overall position');
    expect(container.textContent).toContain('Class position');
    expect(container.querySelector('[data-slot="ledger"]')).toBeNull();

    const openLedger = mustQuery<HTMLButtonElement>(container, '[data-slot="openLedger"]');
    expect(openLedger.textContent).toContain('View results ledger');
    expect(openLedger.textContent).toContain('2 results');

    openLedger.click();

    const dialog = mustQuery<HTMLDialogElement>(container, '[data-slot="ledgerDialog"]');
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Results ledger');
    expect(dialog.textContent).toContain('2 / 45');
    expect(dialog.textContent).toContain('1 / 12');
    expect(dialog.textContent).toContain('2:00:34'); // time-scored race
    expect(dialog.textContent).toContain('50 pts'); // points-scored race

    // the viewed race is highlighted, not a link; the rest are links
    const selected = mustQuery<HTMLTableRowElement>(dialog, '[data-slot="ledgerRows"] tr.is-selected');
    expect(selected.textContent).toContain('Summer Enduro');
    expect(selected.getAttribute('aria-current')).toBe('true');
    expect(mustQuery<HTMLElement>(selected, '.ledger-current-label').textContent).toBe('Current');
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

    mustQuery<HTMLButtonElement>(container, '[data-slot="openLedger"]').click();
    const rows = mustQueryAll<HTMLTableRowElement>(container, '[data-slot="ledgerRows"] tr');
    const secondRow = rows[1];
    if (!secondRow) throw new Error('Expected a second ledger row');
    mustQuery<HTMLButtonElement>(secondRow, 'button').click();
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

  it('passes result statuses to trend charts and labels ledger statuses', () => {
    renderHistory(container, {
      history: {
        racerName: 'Ryan Canavan',
        races: [
          {
            sourceRaceId: 'mototally:points-dnf',
            raceName: 'Foggy Mountain',
            eventDate: '2026-07-19',
            eventDateProvenance: 'source',
            fullName: 'Ryan Canavan',
            provider: 'mototally',
            overallPosition: 47,
            fieldSize: 79,
            overallPercentile: 42,
            classPosition: 5,
            classSize: 10,
            classPercentile: 60,
            totalPoints: 50,
            totalTimeSeconds: null,
            resultStatus: 'official_dnf',
            resultNote: 'DNF after 11 of 13 checks'
          },
          {
            sourceRaceId: 'mototally:no-result',
            raceName: 'Pine Glen',
            eventDate: '2026-07-26',
            provider: 'mototally',
            eventDateProvenance: 'source',
            fullName: 'Ryan Canavan',
            overallPosition: 4,
            fieldSize: 50,
            overallPercentile: null,
            classPosition: 1,
            classSize: 9,
            classPercentile: null,
            totalTimeSeconds: null,
            totalPoints: null,
            resultStatus: 'no_result',
            resultNote: 'No final result'
          }
        ],
        trends: { overallPercentiles: [42, null], classPercentiles: [60, null] }
      },
      selectedSourceRaceId: null,
      onSelectRace: vi.fn()
    });

    expect(container.textContent).toContain('Overall position');
    expect(container.textContent).toContain('Class position');
    expect(container.textContent).toContain('Overall result at each archived event');
    expect(mustQueryAll<SVGTextElement>(container, 'text.end-label').map((label) => label.textContent)).toEqual([
      '47',
      '5'
    ]);
    expect(mustQueryAll<SVGCircleElement>(container, 'circle.pt-dnf')).toHaveLength(2);
    expect(mustQueryAll<SVGCircleElement>(container, 'circle.pt-no-result')).toHaveLength(2);
    mustQuery<HTMLButtonElement>(container, '[data-slot="openLedger"]').click();
    const rows = mustQueryAll<HTMLTableRowElement>(container, '[data-slot="ledgerRows"] tr');
    expect(rows[0]?.textContent).toContain('50 pts · DNF after 11 of 13 checks');
    expect(rows[1]?.textContent).toContain('No final result');
  });
});
