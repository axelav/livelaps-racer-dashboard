import { lineChart, barChart } from './charts.js';
import { deriveSectionSeries, formatDuration, parseDuration } from './livelaps.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <div class="race-actions">
        <button class="back-link" type="button" data-slot="back">&larr; Search another racer</button>
        <div class="snapshot-actions">
          <span data-slot="capturedAt"></span>
          <button type="button" data-slot="refresh">Refresh</button>
        </div>
      </div>
      <div class="notice" data-slot="refreshNotice" role="alert" hidden>
        <p data-slot="refreshNoticeText"></p>
        <button type="button" data-slot="refreshNoticeDismiss" aria-label="Dismiss">&times;</button>
      </div>
      <div class="masthead">
        <p class="eyebrow" data-slot="eyebrow"></p>
        <h1 data-slot="title"></h1>
        <p class="subhead" data-slot="subhead"></p>
      </div>

      <div class="stat-row">
        <div class="stat-tile">
          <p class="stat-label">Overall position</p>
          <p class="stat-value" data-slot="statOverall"></p>
          <p class="stat-sub" data-slot="statOverallSub"></p>
        </div>
        <div class="stat-tile">
          <p class="stat-label">Class position</p>
          <p class="stat-value" data-slot="statClass"></p>
          <p class="stat-sub" data-slot="statClassSub"></p>
        </div>
        <div class="stat-tile">
          <p class="stat-label">Behind the overall leader</p>
          <p class="stat-value" data-slot="statGapLeader"></p>
          <p class="stat-sub" data-slot="statGapLeaderSub"></p>
        </div>
        <div class="stat-tile">
          <p class="stat-label">Average speed</p>
          <p class="stat-value" data-slot="statSpeed"></p>
          <p class="stat-sub" data-slot="statSpeedSub"></p>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2>Overall standing through the race</h2>
          <p class="card-sub" data-slot="overallCardSub"></p>
          <div data-slot="chartOverall"></div>
        </div>

        <div class="card">
          <h2>Class standing through the race</h2>
          <p class="card-sub" data-slot="classCardSub"></p>
          <div data-slot="chartClass"></div>
        </div>

        <div class="card full">
          <h2>Cumulative standing vs. pace that section alone</h2>
          <p class="card-sub">Where they stood overall vs. how that section alone would have ranked, in isolation</p>
          <div data-slot="legendSection"></div>
          <div data-slot="chartSection"></div>
        </div>

        <div class="card">
          <h2>Pace by section</h2>
          <p class="card-sub">Average speed, mph</p>
          <div data-slot="chartSpeed"></div>
        </div>

        <div class="card">
          <h2>Gap to the rider ahead</h2>
          <p class="card-sub">Seconds behind the next overall position, at each checkpoint</p>
          <div data-slot="chartGap"></div>
        </div>
      </div>

      <section class="table-section">
        <h2 class="table-heading">Section-by-section data</h2>
        <table class="data-table" data-slot="table">
          <thead data-slot="tableHead">
            <tr>
              <th>Section</th>
              <th>Cumulative time</th>
              <th>Overall position</th>
              <th>Class position</th>
              <th>Section rank (overall)</th>
              <th>Section rank (class)</th>
              <th>Avg speed (mph)</th>
              <th>Gap ahead (s)</th>
            </tr>
          </thead>
          <tbody data-slot="tableBody"></tbody>
        </table>
      </section>
    </div>
  </div>
`;

function buildLegend(container, items) {
  const wrap = document.createElement('div');
  wrap.className = 'legend';
  items.forEach((it) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const key = document.createElement('span');
    key.className = 'legend-key';
    key.style.background = it.color;
    item.appendChild(key);
    const label = document.createElement('span');
    label.textContent = it.name;
    item.appendChild(label);
    wrap.appendChild(item);
  });
  container.appendChild(wrap);
}

export function renderDashboard(
  container,
  { raceMeta, racer, fieldSize, classSize, capturedAt, onBack, onRefresh }
) {
  container.innerHTML = TEMPLATE;
  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);

  slot('back').addEventListener('click', onBack);
  const capturedDate = new Date(capturedAt);
  slot('capturedAt').textContent = Number.isNaN(capturedDate.getTime())
    ? `Archived ${capturedAt}`
    : `Captured ${capturedDate.toLocaleString()}`;
  slot('refreshNoticeDismiss').addEventListener('click', () => {
    slot('refreshNotice').hidden = true;
  });
  slot('refresh').addEventListener('click', async () => {
    const button = slot('refresh');
    button.disabled = true;
    button.textContent = 'Refreshing…';
    slot('refreshNotice').hidden = true;
    try {
      await onRefresh();
    } catch (error) {
      console.error(error);
      slot('refreshNoticeText').textContent = `${
        error instanceof Error && error.message
          ? error.message
          : 'Unable to refresh the timing source.'
      } The captured results remain available.`;
      slot('refreshNotice').hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh';
    }
  });

  slot('eyebrow').textContent = raceMeta.raceName;
  slot('title').textContent = `${racer.fullName} — enduro breakdown`;

  const subhead = slot('subhead');
  subhead.innerHTML = '';
  const boldBrand = document.createElement('b');
  boldBrand.textContent = `${racer.brand} #${racer.displayedNumber}`;
  subhead.appendChild(boldBrand);

  const overallPct = Math.round((racer.overallPosition / fieldSize) * 100);
  const statOverall = slot('statOverall');
  statOverall.innerHTML = '';
  statOverall.append(`${racer.overallPosition} `);
  const overallSmall = document.createElement('small');
  overallSmall.textContent = `/ ${fieldSize}`;
  statOverall.appendChild(overallSmall);
  slot('statOverallSub').textContent = `top ${overallPct}% of the field`;

  const statClass = slot('statClass');
  statClass.innerHTML = '';
  statClass.append(`${racer.classPosition} `);
  const classSmall = document.createElement('small');
  classSmall.textContent = `/ ${classSize}`;
  statClass.appendChild(classSmall);
  slot('statClassSub').textContent = racer.className;

  const root = container.querySelector('.viz-root');
  const styles = getComputedStyle(root);
  const colorOverall = styles.getPropertyValue('--series-overall').trim();
  const colorClass = styles.getPropertyValue('--series-class').trim();
  const colorSection = styles.getPropertyValue('--series-section').trim();
  const colorSpeed = styles.getPropertyValue('--series-speed').trim();
  const colorGap = styles.getPropertyValue('--series-gap').trim();

  if (racer.scoring === 'points') {
    renderPointsBreakdown(slot, subhead, racer, fieldSize, classSize, {
      overall: colorOverall,
      class: colorClass,
      section: colorSection,
      gap: colorGap
    });
    return;
  }

  const series = deriveSectionSeries(racer);
  const sectionCount = series.names.length;
  subhead.appendChild(
    document.createTextNode(
      ` · Class ${racer.className} · finished in ${series.cumTimes[sectionCount - 1]} across ${sectionCount} timed sections`
    )
  );

  slot('statGapLeader').textContent = formatDuration(parseDuration(racer.overallBehindByLeader));
  slot('statGapLeaderSub').textContent = `behind class leader by ${formatDuration(parseDuration(racer.classBehindByLeader))}`;

  if (racer.avgSpeedTotal != null) {
    const statSpeed = slot('statSpeed');
    statSpeed.innerHTML = '';
    statSpeed.append(`${racer.avgSpeedTotal.toFixed(1)} `);
    const speedSmall = document.createElement('small');
    speedSmall.textContent = 'mph';
    statSpeed.appendChild(speedSmall);
    slot('statSpeedSub').textContent = `across all ${sectionCount} sections`;
  } else {
    slot('statSpeed').closest('.stat-tile').remove();
  }

  slot('overallCardSub').textContent = `Cumulative position among all ${fieldSize} finishers, after each section`;
  slot('classCardSub').textContent = `Cumulative position within ${racer.className} (${classSize} riders), after each section`;

  lineChart(slot('chartOverall'), {
    ariaLabel: 'Overall position by section',
    clampMin: 1,
    labels: series.names,
    series: [{ name: 'Overall position', color: colorOverall, values: series.cumulativeOverallPositions }]
  });

  lineChart(slot('chartClass'), {
    ariaLabel: 'Class position by section',
    clampMin: 1,
    labels: series.names,
    series: [{ name: 'Class position', color: colorClass, values: series.cumulativeClassPositions }]
  });

  buildLegend(slot('legendSection'), [
    { name: 'Cumulative overall position', color: colorOverall },
    { name: "That section's rank alone", color: colorSection }
  ]);
  lineChart(slot('chartSection'), {
    ariaLabel: 'Cumulative position vs section-only rank',
    clampMin: 1,
    labels: series.names,
    series: [
      { name: 'Cumulative overall position', color: colorOverall, values: series.cumulativeOverallPositions },
      { name: 'Section-only rank', color: colorSection, values: series.sectionOnlyOverallRanks }
    ]
  });

  if (racer.avgSpeedTotal != null) {
    barChart(slot('chartSpeed'), {
      ariaLabel: 'Average speed by section',
      labels: series.names,
      values: series.avgSpeeds,
      color: colorSpeed,
      label: 'Avg speed',
      format: (v) => v.toFixed(1)
    });
  } else {
    slot('chartSpeed').closest('.card').remove();
  }

  barChart(slot('chartGap'), {
    ariaLabel: 'Gap to the rider ahead by section',
    labels: series.names,
    values: series.gapAheadSeconds,
    color: colorGap,
    label: 'Gap ahead',
    format: (v) => `${v.toFixed(1)}s`
  });

  const tbody = slot('tableBody');
  series.names.forEach((name, i) => {
    const tr = document.createElement('tr');
    [
      name,
      series.cumTimes[i],
      series.cumulativeOverallPositions[i],
      series.cumulativeClassPositions[i],
      series.sectionOnlyOverallRanks[i],
      series.sectionOnlyClassRanks[i],
      Number.isFinite(series.avgSpeeds[i]) ? series.avgSpeeds[i].toFixed(3) : '—',
      series.gapAheadSeconds[i].toFixed(3)
    ].forEach((val) => {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// Timekeeping enduros are scored in points dropped after key time, with raw
// seconds recorded only at emergency checks (as the tiebreaker).
function renderPointsBreakdown(slot, subhead, racer, fieldSize, classSize, colors) {
  const { sections, checkCount, timedCheckCount } = racer;
  const labels = sections.map((s) => s.sectionName);
  const checkTick = (i) => `C${i + 1}`;

  subhead.appendChild(
    document.createTextNode(
      ` · Class ${racer.className} · finished on ${racer.totalPoints} points (${racer.totalEmergencySeconds} emergency seconds) across ${checkCount} checks · ${timedCheckCount} timed`
    )
  );

  if (racer.maxChk >= checkCount) {
    slot('statGapLeader').textContent = `${racer.pointsBehindOverallLeader} pts`;
    slot('statGapLeaderSub').textContent = `behind class leader by ${racer.pointsBehindClassLeader} pts`;
  } else {
    slot('statGapLeader').textContent = '—';
    slot('statGapLeaderSub').textContent = `completed ${racer.maxChk} of ${checkCount} checks`;
  }

  slot('statSpeed').closest('.stat-tile').remove();

  slot('overallCardSub').textContent = `Cumulative position among all ${fieldSize} finishers, after each check`;
  slot('classCardSub').textContent = `Cumulative position within ${racer.className} (${classSize} riders), after each check`;

  lineChart(slot('chartOverall'), {
    ariaLabel: 'Overall position by check',
    clampMin: 1,
    labels,
    xTick: checkTick,
    series: [{ name: 'Overall position', color: colors.overall, values: sections.map((s) => s.overallPosition) }]
  });

  lineChart(slot('chartClass'), {
    ariaLabel: 'Class position by check',
    clampMin: 1,
    labels,
    xTick: checkTick,
    series: [{ name: 'Class position', color: colors.class, values: sections.map((s) => s.classPosition) }]
  });

  const timedSections = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.timed && s.publishedPlace != null);
  if (timedSections.length >= 2) {
    const sectionCard = slot('chartSection').closest('.card');
    sectionCard.querySelector('h2').textContent = 'Cumulative standing vs. that check alone';
    sectionCard.querySelector('.card-sub').textContent =
      "Where they stood overall vs. how that timed check's seconds alone ranked";
    buildLegend(slot('legendSection'), [
      { name: 'Cumulative overall position', color: colors.overall },
      { name: "That check's rank alone", color: colors.section }
    ]);
    lineChart(slot('chartSection'), {
      ariaLabel: 'Cumulative position vs timed-check rank',
    clampMin: 1,
      labels: timedSections.map(({ s }) => s.sectionName),
      xTick: (k) => `C${timedSections[k].i + 1}`,
      series: [
        {
          name: 'Cumulative overall position',
          color: colors.overall,
          values: timedSections.map(({ s }) => s.overallPosition)
        },
        {
          name: "Timed check's rank alone",
          color: colors.section,
          values: timedSections.map(({ s }) => s.publishedPlace)
        }
      ]
    });
  } else {
    slot('chartSection').closest('.card').remove();
  }

  slot('chartSpeed').closest('.card').remove();

  const gapCard = slot('chartGap').closest('.card');
  gapCard.querySelector('h2').textContent = 'Points dropped per check';
  gapCard.querySelector('.card-sub').textContent = 'Route and emergency checks — lower is better';
  barChart(slot('chartGap'), {
    ariaLabel: 'Points dropped by check',
    labels,
    xTick: checkTick,
    values: sections.map((s) => s.points ?? 0),
    color: colors.gap,
    label: 'Points',
    format: (v) => String(v)
  });

  const thead = slot('tableHead');
  thead.innerHTML = '';
  const headRow = document.createElement('tr');
  [
    'Check',
    'Points',
    'Cumulative points',
    'Emergency time',
    'Check rank (overall)',
    'Overall position',
    'Class position'
  ].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = slot('tableBody');
  sections.forEach((s) => {
    const tr = document.createElement('tr');
    [
      s.sectionName,
      s.points ?? '—',
      s.cumPoints,
      s.seconds != null ? formatDuration(s.seconds) : '—',
      s.publishedPlace ?? '—',
      s.overallPosition,
      s.classPosition
    ].forEach((val) => {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
