import { lineChart } from './charts.js';

const RACER_NAME_KEY = 'enduro-breakdown.racer-name';

export function normalizeRacerName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function loadSavedRacerName(storage = localStorage) {
  return storage.getItem(RACER_NAME_KEY);
}

export function saveRacerName(name, storage = localStorage) {
  storage.setItem(RACER_NAME_KEY, name);
}

export function clearSavedRacerName(storage = localStorage) {
  storage.removeItem(RACER_NAME_KEY);
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

export function renderHistory(
  container,
  { history, selectedSourceRaceId, onSelectRace, onClear }
) {
  const races = history.races ?? [];
  container.innerHTML = `
    <section class="history-dashboard" aria-label="Racer history dashboard">
      <div class="history-heading">
        <div>
          <p class="eyebrow">History dashboard</p>
          <h2 data-slot="racerName"></h2>
          <p class="card-sub">Every archived event matching this racer name.</p>
        </div>
        <button type="button" class="history-clear" data-slot="clearHistory">Clear saved racer</button>
      </div>
      <div class="history-picker">
        <label for="race-picker">Race detail</label>
        <select id="race-picker" data-slot="racePicker"></select>
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
        <section class="history-ledger">
          <h3>Results ledger</h3>
          <table class="data-table">
            <thead><tr><th>Date</th><th>Race</th><th>Source</th><th>Overall</th><th>Class</th><th>Time</th></tr></thead>
            <tbody data-slot="ledger"></tbody>
          </table>
        </section>
      </div>
    </section>
  `;

  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);
  slot('racerName').textContent = history.racerName ?? 'Racer history';
  const picker = slot('racePicker');
  races.forEach((race) => {
    const option = document.createElement('option');
    option.value = race.sourceRaceId;
    option.selected = race.sourceRaceId === selectedSourceRaceId;
    option.textContent = `${raceDate(race)} — ${race.raceName} (${sourceLabel(race.provider)})`;
    picker.appendChild(option);
  });
  picker.addEventListener('change', () => onSelectRace(picker.value));
  slot('clearHistory').addEventListener('click', onClear);

  if (races.length === 0) {
    picker.disabled = true;
    slot('historyData').textContent = 'No archived events yet.';
    return;
  }

  const labels = races.map((race) => race.eventDate ?? race.raceName);
  lineChart(slot('overallTrend'), {
    ariaLabel: 'Overall percentile across archived events',
    labels,
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
    series: [
      {
        name: 'Class percentile',
        color: '#1baf7a',
        values: history.trends?.classPercentiles ?? races.map((race) => race.classPercentile)
      }
    ]
  });

  const ledger = slot('ledger');
  races.forEach((race) => {
    const row = document.createElement('tr');
    [
      raceDate(race),
      race.raceName,
      sourceLabel(race.provider),
      `${race.overallPosition ?? '—'} / ${race.fieldSize ?? '—'}`,
      `${race.classPosition ?? '—'} / ${race.classSize ?? '—'}`,
      formatDuration(race.totalTimeSeconds)
    ].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    ledger.appendChild(row);
  });
}
