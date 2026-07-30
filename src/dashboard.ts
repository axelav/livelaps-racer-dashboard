import { lineChart, barChart } from './charts.js';
import { deriveSectionSeries, formatDuration, parseDuration } from './livelaps.js';
import type { PointsSection, RaceEntry, RaceMeta, TimedSection } from './domain.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <div class="race-actions">
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
        <table class="data-table section-data-table" data-slot="table">
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

type LegendItem = {
  name: string;
  color: string;
};

type Colors = {
  overall: string;
  class: string;
  section: string;
  gap: string;
};

type DashboardTimedRacer = Omit<RaceEntry, 'sections' | 'scoring' | 'id' | 'displayedNumber' | 'brand' | 'className' | 'overallPosition' | 'classPosition'> & {
  scoring?: 'timed';
  id: string | number;
  fullName: string;
  displayedNumber: string | number;
  brand: string;
  className: string;
  overallPosition: number;
  classPosition: number;
  avgSpeedTotal?: number | null;
  overallBehindByLeader?: string | null;
  classBehindByLeader?: string | null;
  sections: TimedSection[];
};

type DashboardPointsRacer = Omit<RaceEntry, 'sections' | 'scoring' | 'id' | 'displayedNumber' | 'brand' | 'className' | 'overallPosition' | 'classPosition'> & {
  scoring: 'points';
  id: string | number;
  fullName: string;
  displayedNumber: string | number;
  brand: string;
  className: string;
  overallPosition: number;
  classPosition: number;
  maxChk: number;
  checkCount: number;
  timedCheckCount: number;
  totalPoints: number | null;
  totalEmergencySeconds: number | null;
  pointsBehindOverallLeader: number;
  pointsBehindClassLeader: number;
  sections: PointsSection[];
};

export type DashboardRacer = DashboardTimedRacer | DashboardPointsRacer;

export type RenderDashboardOptions = {
  raceMeta: RaceMeta;
  racer: DashboardRacer;
  fieldSize: number;
  classSize: number;
  capturedAt: string;
  onRefresh: () => Promise<void>;
};

type SlotGetter = {
  <T extends HTMLElement = HTMLElement>(name: string): T;
};

function requireElement<T extends Element>(value: T | null, label: string): T {
  if (!value) throw new Error(`Missing dashboard element: ${label}`);
  return value;
}

function buildLegend(container: HTMLElement, items: readonly LegendItem[]): void {
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

function durationOrDash(value: string | null | undefined): string {
  return value ? formatDuration(parseDuration(value)) : '—';
}

export function renderDashboard(container: HTMLElement, { raceMeta, racer, fieldSize, classSize, capturedAt, onRefresh }: RenderDashboardOptions): void {
  container.innerHTML = TEMPLATE;
  const slot: SlotGetter = <T extends HTMLElement = HTMLElement>(name: string): T =>
    requireElement(container.querySelector<T>(`[data-slot="${name}"]`), name);

  const capturedDate = new Date(capturedAt);
  slot('capturedAt').textContent = Number.isNaN(capturedDate.getTime())
    ? `Archived ${capturedAt}`
    : `Captured ${capturedDate.toLocaleString()}`;
  slot<HTMLButtonElement>('refreshNoticeDismiss').addEventListener('click', () => {
    slot('refreshNotice').hidden = true;
  });
  slot<HTMLButtonElement>('refresh').addEventListener('click', async () => {
    const button = slot<HTMLButtonElement>('refresh');
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

  const subhead = slot<HTMLParagraphElement>('subhead');
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

  const root = requireElement(container.querySelector('.viz-root'), 'viz-root');
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
      // amber, not the section purple: blue/purple is indistinguishable under
      // red-green CVD on the dark surface (validated ΔE 1.9); blue/amber passes
      // both modes. Free here — points mode has no speed chart.
      section: colorSpeed,
      gap: colorGap
    });
    return;
  }

  const series = deriveSectionSeries(racer);
  const sectionCount = series.names.length;
  const completedSections = series.cumTimes.filter((time) => time != null).length;
  const finalTime = series.cumTimes.at(-1);
  const finishSummary =
    finalTime == null
      ? `DNF after ${completedSections} of ${sectionCount} timed sections`
      : `finished in ${finalTime} across ${sectionCount} timed sections`;
  subhead.appendChild(
    document.createTextNode(` · Class ${racer.className} · ${finishSummary}`)
  );

  slot('statGapLeader').textContent = durationOrDash(racer.overallBehindByLeader);
  slot('statGapLeaderSub').textContent = `behind class leader by ${durationOrDash(racer.classBehindByLeader)}`;

  if (racer.avgSpeedTotal != null) {
    const statSpeed = slot('statSpeed');
    statSpeed.innerHTML = '';
    statSpeed.append(`${racer.avgSpeedTotal.toFixed(1)} `);
    const speedSmall = document.createElement('small');
    speedSmall.textContent = 'mph';
    statSpeed.appendChild(speedSmall);
    slot('statSpeedSub').textContent = `across all ${sectionCount} sections`;
  } else {
    requireElement(slot('statSpeed').closest('.stat-tile'), 'statSpeed tile').remove();
  }

  slot('overallCardSub').textContent = `Estimated from cumulative section times; final point is the official result`;
  slot('classCardSub').textContent = `Estimated within ${racer.className}; final point is the official class result`;

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
      format: (v: number) => v.toFixed(1)
    });
  } else {
    requireElement(slot('chartSpeed').closest('.card'), 'speed card').remove();
  }

  barChart(slot('chartGap'), {
    ariaLabel: 'Gap to the rider ahead by section',
    labels: series.names,
    values: series.gapAheadSeconds,
    color: colorGap,
    label: 'Gap ahead',
    format: (v: number) => `${v.toFixed(1)}s`
  });

  const labels = ['Section', 'Cum time', 'Overall pos', 'Class pos', 'Section overall', 'Section class', 'Avg mph', 'Gap ahead'];
  const tbody = slot<HTMLTableSectionElement>('tableBody');
  series.names.forEach((name, i) => {
    const tr = document.createElement('tr');
    const avgSpeed = series.avgSpeeds[i];
    const gapAhead = series.gapAheadSeconds[i];
    [
      name,
      series.cumTimes[i],
      series.cumulativeOverallPositions[i],
      series.cumulativeClassPositions[i],
      series.sectionOnlyOverallRanks[i],
      series.sectionOnlyClassRanks[i],
      typeof avgSpeed === 'number' && Number.isFinite(avgSpeed) ? avgSpeed.toFixed(3) : '—',
      gapAhead == null ? '' : gapAhead.toFixed(3)
    ].forEach((val, index) => {
      const td = document.createElement('td');
      td.dataset.label = labels[index] ?? '';
      if (index === 0) td.className = 'section-row-title';
      td.textContent = val == null ? '' : String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// Timekeeping enduros are scored in points dropped after key time, with raw
// seconds recorded only at emergency checks (as the tiebreaker).
function renderPointsBreakdown(slot: SlotGetter, subhead: HTMLElement, racer: DashboardPointsRacer, fieldSize: number, classSize: number, colors: Colors): void {
  const { sections, checkCount, timedCheckCount } = racer;
  const labels = sections.map((s) => s.sectionName);
  const checkTick = (i: number): string => `C${i + 1}`;

  const scoreSummary =
    racer.maxChk >= checkCount
      ? `finished on ${racer.totalPoints} points (${racer.totalEmergencySeconds} emergency seconds) across ${checkCount} checks · ${timedCheckCount} timed`
      : `DNF after ${racer.maxChk} of ${checkCount} checks · ${racer.totalPoints} points (${racer.totalEmergencySeconds} emergency seconds) · ${timedCheckCount} timed`;
  subhead.appendChild(document.createTextNode(` · Class ${racer.className} · ${scoreSummary}`));

  if (racer.maxChk >= checkCount) {
    slot('statGapLeader').textContent = `${racer.pointsBehindOverallLeader} pts`;
    slot('statGapLeaderSub').textContent = `behind class leader by ${racer.pointsBehindClassLeader} pts`;
  } else {
    slot('statGapLeader').textContent = '—';
    slot('statGapLeaderSub').textContent = `completed ${racer.maxChk} of ${checkCount} checks`;
  }

  requireElement(slot('statSpeed').closest('.stat-tile'), 'statSpeed tile').remove();

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

  const sectionCard = requireElement(slot('chartSection').closest('.card'), 'section card');
  requireElement(sectionCard.querySelector('h2'), 'section card title').textContent = 'Cumulative standing vs. that check alone';
  requireElement(sectionCard.querySelector('.card-sub'), 'section card subtitle').textContent =
    'Where they stood overall vs. how that check alone ranked — riders tied on a check share the best rank';
  buildLegend(slot('legendSection'), [
    { name: 'Cumulative overall position', color: colors.overall },
    { name: "That check's rank alone", color: colors.section }
  ]);
  lineChart(slot('chartSection'), {
    ariaLabel: 'Cumulative position vs check-alone rank',
    clampMin: 1,
    labels,
    xTick: checkTick,
    series: [
      {
        name: 'Cumulative overall position',
        color: colors.overall,
        values: sections.map((s) => s.overallPosition)
      },
      {
        name: "That check's rank alone",
        color: colors.section,
        values: sections.map((s) => s.sectionOverallPosition)
      }
    ]
  });

  requireElement(slot('chartSpeed').closest('.card'), 'speed card').remove();

  const gapCard = requireElement(slot('chartGap').closest('.card'), 'gap card');
  requireElement(gapCard.querySelector('h2'), 'gap card title').textContent = 'Points dropped per check';
  requireElement(gapCard.querySelector('.card-sub'), 'gap card subtitle').textContent = 'Route and emergency checks — lower is better';
  barChart(slot('chartGap'), {
    ariaLabel: 'Points dropped by check',
    labels,
    xTick: checkTick,
    values: sections.map((s) => s.points ?? 0),
    color: colors.gap,
    label: 'Points',
    format: (v: number) => String(v)
  });

  const headings: [string, string][] = [
    ['Check', 'Check'],
    ['Points', 'Pts'],
    ['Cumulative points', 'Cum'],
    ['Emergency time', 'Emerg'],
    ['Check rank (overall)', 'Chk overall'],
    ['Check rank (class)', 'Chk class'],
    ['Overall position', 'Pos overall'],
    ['Class position', 'Pos class']
  ];
  const thead = slot<HTMLTableSectionElement>('tableHead');
  thead.innerHTML = '';
  const headRow = document.createElement('tr');
  headings.forEach(([label]) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = slot<HTMLTableSectionElement>('tableBody');
  sections.forEach((s) => {
    const tr = document.createElement('tr');
    [
      s.sectionName,
      s.points ?? '—',
      s.cumPoints,
      s.seconds != null ? formatDuration(s.seconds) : '—',
      s.sectionOverallPosition ?? '—',
      s.sectionClassPosition ?? '—',
      s.overallPosition,
      s.classPosition
    ].forEach((val, index) => {
      const td = document.createElement('td');
      td.dataset.label = headings[index]?.[1] ?? '';
      if (index === 0) td.className = 'section-row-title';
      td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
