import { lineChart } from './charts.js';
import { historySeriesColors } from './seriesColors.js';

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

function comparisonTrendSeries(races, comparisonHistories, colors, metric) {
  return comparisonHistories.map((comparison, index) => {
    const raceById = new Map((comparison.races ?? []).map((race) => [race.sourceRaceId, race]));
    return {
      name: comparison.racerName,
      color: colors.comparisons[comparison.slot ?? index],
      values: races.map((race) => raceById.get(race.sourceRaceId)?.[metric] ?? null)
    };
  });
}

function classComparisonTrendSeries(races, comparisonHistories, colors) {
  const omitted = [];
  const series = [];
  comparisonHistories.forEach((comparison, index) => {
    const raceById = new Map((comparison.races ?? []).map((race) => [race.sourceRaceId, race]));
    const values = races.map((race) => {
      const comparisonRace = raceById.get(race.sourceRaceId);
      return comparisonRace?.className && race.className === comparisonRace.className
        ? comparisonRace.classPercentile
        : null;
    });
    if (values.some((value) => value != null)) {
      series.push({
        name: comparison.racerName,
        color: colors.comparisons[comparison.slot ?? index],
        values
      });
    } else {
      omitted.push(comparison.racerName);
    }
  });
  return { omitted, series };
}

function comparisonRaceMaps(comparisonHistories) {
  return comparisonHistories.map((comparison) => ({
    ...comparison,
    raceById: new Map((comparison.races ?? []).map((race) => [race.sourceRaceId, race]))
  }));
}

function signedDelta(delta) {
  if (!Number.isFinite(delta)) return '—';
  return delta > 0 ? `+${delta}` : String(delta);
}

function headToHeadLine(anchorName, comparison, races) {
  let anchorWins = 0;
  let comparisonWins = 0;
  races.forEach((race) => {
    const comparisonRace = comparison.raceById.get(race.sourceRaceId);
    if (!Number.isFinite(race.overallPosition) || !Number.isFinite(comparisonRace?.overallPosition)) {
      return;
    }
    if (race.overallPosition < comparisonRace.overallPosition) anchorWins += 1;
    else if (comparisonRace.overallPosition < race.overallPosition) comparisonWins += 1;
  });
  if (anchorWins >= comparisonWins) {
    return `${anchorName} leads ${comparison.racerName} ${anchorWins}-${comparisonWins}`;
  }
  return `${comparison.racerName} leads ${anchorName} ${comparisonWins}-${anchorWins}`;
}

function renderComparisonLegend(container, comparisons) {
  container.innerHTML = '';
  if (comparisons.length < 4) return;
  const list = document.createElement('div');
  list.className = 'legend';
  comparisons.forEach((comparison) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.textContent = comparison.racerName;
    list.appendChild(item);
  });
  container.appendChild(list);
}

function renderCandidateList(container, candidates, onAddComparisonRider) {
  container.innerHTML = '';
  candidates.forEach((candidate) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'comparison-candidate';
    button.dataset.candidate = candidate.normalizedName;
    button.textContent = `${candidate.fullName} · ${candidate.sharedRoundCount} shared ${
      candidate.sharedRoundCount === 1 ? 'round' : 'rounds'
    }`;
    button.addEventListener('click', () => onAddComparisonRider?.(candidate.normalizedName));
    container.appendChild(button);
  });
}

export function renderHistory(
  container,
  {
    history,
    selectedSourceRaceId,
    onSelectRace,
    comparisonCandidates = [],
    comparisonHistories = [],
    comparisonNotices = [],
    onAddComparisonRider,
    onSearchComparisonRiders
  }
) {
  const races = history.races ?? [];
  container.innerHTML = `
    <section class="history-dashboard" aria-label="Racer history dashboard">
      <div class="history-heading">
        <div>
          <p class="eyebrow">History dashboard</p>
          <h2 data-slot="racerName"></h2>
        </div>
        <div class="history-actions">
          <button type="button" data-slot="comparisonToggle">Compare riders</button>
          <div class="comparison-picker" data-slot="comparisonPicker" hidden>
            <label>
              Search riders
              <input type="search" data-slot="comparisonSearch" autocomplete="off">
            </label>
            <div data-slot="comparisonCandidates"></div>
          </div>
        </div>
      </div>
      <div data-slot="historyData">
        <p class="notice" data-slot="comparisonNotice" hidden></p>
        <div class="history-trends">
          <div class="card">
            <h3>Overall percentile</h3>
            <p class="card-sub">Relative to every finisher at each archived event</p>
            <div data-slot="overallTrend"></div>
          </div>
          <div class="card">
            <h3>Class percentile</h3>
            <p class="card-sub">Relative to the racer's class at each archived event</p>
            <p class="card-sub" data-slot="classComparisonNote"></p>
            <div data-slot="classTrend"></div>
          </div>
        </div>
        <section class="history-ledger">
          <h3>Results ledger</h3>
          <div data-slot="headToHead"></div>
          <div data-slot="comparisonLegend"></div>
          <div class="history-ledger-scroll">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Race</th><th>Source</th><th>Overall</th><th>Class</th><th>Result</th></tr></thead>
              <tbody data-slot="ledger"></tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  `;

  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);
  slot('racerName').textContent = history.racerName ?? 'Racer history';

  const comparisonPicker = slot('comparisonPicker');
  const comparisonCandidateList = slot('comparisonCandidates');
  renderCandidateList(comparisonCandidateList, comparisonCandidates, onAddComparisonRider);
  slot('comparisonToggle').addEventListener('click', () => {
    comparisonPicker.hidden = !comparisonPicker.hidden;
  });
  slot('comparisonSearch').addEventListener('input', async (event) => {
    if (!onSearchComparisonRiders) return;
    const candidates = await onSearchComparisonRiders(event.target.value);
    renderCandidateList(comparisonCandidateList, candidates, onAddComparisonRider);
  });

  if (comparisonNotices.length > 0) {
    slot('comparisonNotice').hidden = false;
    slot('comparisonNotice').textContent = comparisonNotices.join(' ');
  }
  if (races.length === 0) {
    slot('historyData').textContent = 'No archived events yet.';
    return;
  }

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
  const colors = historySeriesColors(container);
  const classComparison = classComparisonTrendSeries(races, comparisonHistories, colors);
  if (classComparison.omitted.length > 0) {
    const anchorClass = races.find((race) => race.className)?.className ?? 'the Anchor Racer class';
    slot('classComparisonNote').textContent = `${classComparison.omitted.join(', ')} omitted from class percentile because they are outside ${anchorClass}`;
  }
  // Percentiles are higher-is-better: plot them upward, bounded to 0..100.
  lineChart(slot('overallTrend'), {
    ariaLabel: 'Overall percentile across archived events',
    labels,
    xTick: dateTick,
    invert: false,
    clampMin: 0,
    clampMax: 100,
    series: [
      {
        name: 'Overall percentile',
        color: colors.overall,
        values: history.trends?.overallPercentiles ?? races.map((race) => race.overallPercentile)
      },
      ...comparisonTrendSeries(races, comparisonHistories, colors, 'overallPercentile')
    ]
  });
  lineChart(slot('classTrend'), {
    ariaLabel: 'Class percentile across archived events',
    labels,
    xTick: dateTick,
    invert: false,
    clampMin: 0,
    clampMax: 100,
    series: [
      {
        name: 'Class percentile',
        color: colors.class,
        values: history.trends?.classPercentiles ?? races.map((race) => race.classPercentile)
      },
      ...classComparison.series
    ]
  });

  const comparisons = comparisonRaceMaps(comparisonHistories);
  if (comparisons.length > 0) {
    const headToHead = slot('headToHead');
    const title = document.createElement('h4');
    title.textContent = 'Head-to-head';
    headToHead.appendChild(title);
    const list = document.createElement('ul');
    comparisons.forEach((comparison) => {
      const item = document.createElement('li');
      item.textContent = headToHeadLine(history.racerName ?? 'Anchor Racer', comparison, races);
      list.appendChild(item);
    });
    headToHead.appendChild(list);
  }
  const headRow = container.querySelector('.history-ledger thead tr');
  comparisons.forEach((comparison) => {
    const th = document.createElement('th');
    th.textContent = comparison.racerName;
    headRow.appendChild(th);
  });

  renderComparisonLegend(slot('comparisonLegend'), comparisons);
  const ledger = slot('ledger');
  races.forEach((race) => {
    const row = document.createElement('tr');
    const isSelected = race.sourceRaceId === selectedSourceRaceId;
    if (isSelected) row.className = 'is-selected';
    [
      raceDate(race),
      race,
      sourceLabel(race.provider),
      `${race.overallPosition ?? '—'} / ${race.fieldSize ?? '—'}`,
      `${race.classPosition ?? '—'} / ${race.classSize ?? '—'}`,
      race.totalPoints != null ? `${race.totalPoints} pts` : formatDuration(race.totalTimeSeconds),
      ...comparisons.map((comparison) => {
        const comparisonRace = comparison.raceById.get(race.sourceRaceId);
        if (!comparisonRace) return '—';
        return `${comparisonRace.overallPosition ?? '—'} (${signedDelta(
          comparisonRace.overallPosition - race.overallPosition
        )})`;
      })
    ].forEach((value) => {
      const cell = document.createElement('td');
      if (value === race) {
        // the selected race isn't a link — it's what's already on screen
        if (isSelected) {
          cell.textContent = race.raceName;
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
