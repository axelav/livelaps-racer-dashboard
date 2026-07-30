import { lineChart } from './charts.js';
import type { HistoryRace, Provider, RacerHistory } from './domain.js';

export type RenderHistoryOptions = {
  history: RacerHistory;
  selectedSourceRaceId: string | null;
  onSelectRace: (sourceRaceId: string) => void | Promise<void>;
};

function requireElement<T extends Element>(value: T | null, label: string): T {
  if (!value) throw new Error(`Missing history element: ${label}`);
  return value;
}

function requireAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Missing history item.');
  return item;
}

export function normalizeRacerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

function formatDuration(totalSeconds: number | null): string {
  if (!Number.isFinite(totalSeconds)) return '—';
  const secondsValue = Number(totalSeconds);
  const hours = Math.floor(secondsValue / 3600);
  const minutes = Math.floor((secondsValue % 3600) / 60);
  const seconds = Math.floor(secondsValue % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sourceLabel(provider: Provider): string {
  return provider === 'mototally' ? 'Moto-Tally' : 'LiveLaps';
}

function raceDate(race: HistoryRace): string {
  if (!race.eventDate) return 'Date unavailable';
  return race.eventDateProvenance === 'source' ? race.eventDate : `${race.eventDate} (unverified)`;
}

function raceResult(race: HistoryRace): string {
  if (race.resultStatus === 'no_result') return race.resultNote || 'No final result';
  const base = race.totalPoints != null ? `${race.totalPoints} pts` : formatDuration(race.totalTimeSeconds);
  return race.resultStatus === 'official_dnf' && race.resultNote ? `${base} · ${race.resultNote}` : base;
}

function positionValue(race: HistoryRace, field: 'overall' | 'class'): number | null {
  if (race.resultStatus === 'no_result') return null;
  return field === 'overall' ? race.overallPosition : race.classPosition;
}

function positionTooltip(race: HistoryRace, field: 'overall' | 'class'): string {
  if (race.resultStatus === 'no_result') return race.resultNote || 'No final result';
  const position = field === 'overall' ? race.overallPosition : race.classPosition;
  const size = field === 'overall' ? race.fieldSize : race.classSize;
  const percentile = field === 'overall' ? race.overallPercentile : race.classPercentile;
  const base = `${position ?? '—'} / ${size ?? '—'}`;
  return percentile == null ? base : `${base} · ${percentile} percentile`;
}

export function renderHistory(container: HTMLElement, { history, selectedSourceRaceId, onSelectRace }: RenderHistoryOptions): void {
  const races = history.races ?? [];
  container.innerHTML = `
    <section class="history-dashboard" aria-label="Racer history dashboard">
      <div class="history-heading">
        <div>
          <p class="eyebrow">History dashboard</p>
          <h2 data-slot="racerName"></h2>
        </div>
      </div>
      <div data-slot="historyData">
        <div class="history-trends">
          <div class="card">
            <h3>Overall position</h3>
            <p class="card-sub">Overall result at each archived event</p>
            <div data-slot="overallTrend"></div>
          </div>
          <div class="card">
            <h3>Class position</h3>
            <p class="card-sub">Class result at each archived event</p>
            <div data-slot="classTrend"></div>
          </div>
        </div>
        <section class="history-ledger-summary" aria-label="Results ledger summary">
          <div>
            <h3>Results ledger</h3>
            <p class="card-sub" data-slot="ledgerSummary"></p>
          </div>
          <button type="button" class="secondary-action" data-slot="openLedger"></button>
        </section>
        <dialog class="ledger-dialog" data-slot="ledgerDialog" aria-labelledby="ledgerTitle">
          <div class="ledger-dialog-head">
            <div>
              <h3 id="ledgerTitle">Results ledger</h3>
              <p class="card-sub" data-slot="ledgerDialogSummary"></p>
            </div>
            <button type="button" class="dialog-close" data-slot="closeLedger" aria-label="Close results ledger">Close</button>
          </div>
          <table class="data-table ledger-table">
            <thead><tr><th>Date</th><th>Race</th><th>Source</th><th>Overall</th><th>Class</th><th>Result</th></tr></thead>
            <tbody data-slot="ledgerRows"></tbody>
          </table>
        </dialog>
      </div>
    </section>
  `;

  const slot = <T extends HTMLElement = HTMLElement>(name: string): T =>
    requireElement(container.querySelector<T>(`[data-slot="${name}"]`), name);
  slot('racerName').textContent = history.racerName ?? 'Racer history';

  if (races.length === 0) {
    slot('historyData').textContent = 'No archived events yet.';
    return;
  }

  const resultLabel = races.length === 1 ? '1 result' : `${races.length} results`;
  slot('ledgerSummary').textContent = `${resultLabel} across archived events`;
  slot('ledgerDialogSummary').textContent = `${resultLabel} across archived events`;
  slot('openLedger').textContent = `View results ledger (${resultLabel})`;

  const ledgerDialog = slot<HTMLDialogElement>('ledgerDialog');
  slot<HTMLButtonElement>('openLedger').addEventListener('click', () => {
    if (typeof ledgerDialog.showModal === 'function') {
      ledgerDialog.showModal();
    } else {
      ledgerDialog.setAttribute('open', '');
    }
  });
  slot<HTMLButtonElement>('closeLedger').addEventListener('click', () => {
    if (typeof ledgerDialog.close === 'function') {
      ledgerDialog.close();
    } else {
      ledgerDialog.removeAttribute('open');
    }
  });

  // Tooltip titles carry the full story; axis ticks compress to short dates.
  const labels = races.map((race) =>
    race.eventDate ? `${race.eventDate} — ${race.raceName}` : race.raceName
  );
  const dateTick = (i: number): string => {
    const date = requireAt(races, i).eventDate;
    if (!date) return `#${i + 1}`;
    const [, month, day] = date.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  // Positions are lower-is-better: plot them upward with 1 at the top.
  lineChart(slot('overallTrend'), {
    ariaLabel: 'Overall position across archived events',
    labels,
    xTick: dateTick,
    maxXTicks: 6,
    clampMin: 1,
    series: [
      {
        name: 'Overall position',
        color: '#2a78d6',
        values: races.map((race) => positionValue(race, 'overall')),
        tooltipValues: races.map((race) => positionTooltip(race, 'overall')),
        statuses: races.map((race) => race.resultStatus),
        statusLabels: races.map((race) => race.resultNote)
      }
    ]
  });
  lineChart(slot('classTrend'), {
    ariaLabel: 'Class position across archived events',
    labels,
    xTick: dateTick,
    maxXTicks: 6,
    clampMin: 1,
    series: [
      {
        name: 'Class position',
        color: '#1baf7a',
        values: races.map((race) => positionValue(race, 'class')),
        tooltipValues: races.map((race) => positionTooltip(race, 'class')),
        statuses: races.map((race) => race.resultStatus),
        statusLabels: races.map((race) => race.resultNote)
      }
    ]
  });

  const ledger = slot<HTMLTableSectionElement>('ledgerRows');
  const ledgerLabels = ['Date', 'Race', 'Source', 'Overall', 'Class', 'Result'];
  races.forEach((race) => {
    const row = document.createElement('tr');
    const isSelected = race.sourceRaceId === selectedSourceRaceId;
    if (isSelected) {
      row.className = 'is-selected';
      row.setAttribute('aria-current', 'true');
    }
    [
      raceDate(race),
      race,
      sourceLabel(race.provider),
      `${race.overallPosition ?? '—'} / ${race.fieldSize ?? '—'}`,
      `${race.classPosition ?? '—'} / ${race.classSize ?? '—'}`,
      raceResult(race)
    ].forEach((value: string | HistoryRace, index) => {
      const cell = document.createElement('td');
      cell.dataset.label = ledgerLabels[index] ?? '';
      if (value === race) {
        // the selected race isn't a link — it's what's already on screen
        if (isSelected) {
          const raceName = document.createElement('span');
          raceName.textContent = race.raceName;
          const current = document.createElement('span');
          current.className = 'ledger-current-label';
          current.textContent = 'Current';
          cell.append(raceName, current);
        } else {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'ledger-race-link';
          link.textContent = race.raceName;
          link.addEventListener('click', () => onSelectRace(race.sourceRaceId));
          cell.appendChild(link);
        }
      } else {
        cell.textContent = String(value);
      }
      row.appendChild(cell);
    });
    ledger.appendChild(row);
  });
}
