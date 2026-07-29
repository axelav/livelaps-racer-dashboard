import { lineChart } from './charts.js';

export function normalizeRacerName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sourceLabel(provider) {
  return provider === 'mototally' ? 'Moto-Tally' : 'LiveLaps';
}

function raceDate(race) {
  if (!race.eventDate) return 'Date unavailable';
  return race.eventDateProvenance === 'source' ? race.eventDate : `${race.eventDate} (unverified)`;
}

export function renderHistory(container, { history, selectedSourceRaceId, onSelectRace }) {
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
            <h3>Overall percentile</h3>
            <p class="card-sub">Relative to every finisher at each archived event</p>
            <div data-slot="overallTrend"></div>
          </div>
          <div class="card">
            <h3>Class percentile</h3>
            <p class="card-sub">Relative to the racer's class at each archived event</p>
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

  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);
  slot('racerName').textContent = history.racerName ?? 'Racer history';

  if (races.length === 0) {
    slot('historyData').textContent = 'No archived events yet.';
    return;
  }

  const resultLabel = races.length === 1 ? '1 result' : `${races.length} results`;
  slot('ledgerSummary').textContent = `${resultLabel} across archived events`;
  slot('ledgerDialogSummary').textContent = `${resultLabel} across archived events`;
  slot('openLedger').textContent = `View results ledger (${resultLabel})`;

  const ledgerDialog = slot('ledgerDialog');
  slot('openLedger').addEventListener('click', () => {
    if (typeof ledgerDialog.showModal === 'function') {
      ledgerDialog.showModal();
    } else {
      ledgerDialog.setAttribute('open', '');
    }
  });
  slot('closeLedger').addEventListener('click', () => {
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
  const dateTick = (i) => {
    const date = races[i].eventDate;
    if (!date) return `#${i + 1}`;
    const [, month, day] = date.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  // Percentiles are higher-is-better: plot them upward, bounded to 0..100.
  lineChart(slot('overallTrend'), {
    ariaLabel: 'Overall percentile across archived events',
    labels,
    xTick: dateTick,
    maxXTicks: 6,
    invert: false,
    clampMin: 0,
    clampMax: 100,
    series: [
      {
        name: 'Overall percentile',
        color: '#2a78d6',
        values: history.trends?.overallPercentiles ?? races.map((race) => race.overallPercentile)
      }
    ]
  });
  lineChart(slot('classTrend'), {
    ariaLabel: 'Class percentile across archived events',
    labels,
    xTick: dateTick,
    maxXTicks: 6,
    invert: false,
    clampMin: 0,
    clampMax: 100,
    series: [
      {
        name: 'Class percentile',
        color: '#1baf7a',
        values: history.trends?.classPercentiles ?? races.map((race) => race.classPercentile)
      }
    ]
  });

  const ledger = slot('ledgerRows');
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
      race.totalPoints != null ? `${race.totalPoints} pts` : formatDuration(race.totalTimeSeconds)
    ].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.dataset.label = ['Date', 'Race', 'Source', 'Overall', 'Class', 'Result'][index];
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
        cell.textContent = value;
      }
      row.appendChild(cell);
    });
    ledger.appendChild(row);
  });
}
