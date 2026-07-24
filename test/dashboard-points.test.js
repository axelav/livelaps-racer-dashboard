import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { sanitizeHtml, parseResults, deriveStandings } from '../src/mototally.js';
import { deriveTotals } from '../src/livelaps.js';
import { renderDashboard } from '../src/dashboard.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/foggy-mountain-o1.html', import.meta.url));

let standings;
let win;

function render(participantId) {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const totals = deriveTotals(standings, participantId);
  renderDashboard(container, {
    raceMeta: { raceName: '2026 FOGGY MOUNTAIN ENDURO', modeName: 'Enduro' },
    ...totals,
    onBack: () => {}
  });
  return container;
}

beforeAll(async () => {
  win = new Window();
  global.document = win.document;
  global.getComputedStyle = win.getComputedStyle.bind(win);
  win.document.body.innerHTML = sanitizeHtml(readFileSync(FIXTURE_PATH, 'utf8'));
  standings = deriveStandings(parseResults(win.document));
  win.document.body.innerHTML = '';
});

describe('renderDashboard for a points-scored racer', () => {
  it('summarizes points, emergency seconds, and check counts in the subhead', () => {
    const c = render(3279244);
    const subhead = c.querySelector('[data-slot="subhead"]').textContent;
    expect(subhead).toContain('HUS #17B');
    expect(subhead).toContain('Class A SR 40+');
    expect(subhead).toContain('finished on 50 points (1252 emergency seconds) across 13 checks · 3 timed');
  });

  it('shows correct position tiles and points behind leaders', () => {
    const c = render(3279244);
    expect(c.querySelector('[data-slot="statOverall"]').textContent).toContain('47');
    expect(c.querySelector('[data-slot="statClass"]').textContent.replace(/\s+/g, ' ')).toContain('5 / 10');
    expect(c.querySelector('[data-slot="statGapLeader"]').textContent).toBe('25 pts');
    expect(c.querySelector('[data-slot="statGapLeaderSub"]').textContent).toBe(
      'behind class leader by 20 pts'
    );
  });

  it('marks riders who missed checks instead of showing a bogus points gap', () => {
    const c = render(3386973); // COLIN QUIRIN, 7 of 13 checks
    expect(c.querySelector('[data-slot="statGapLeader"]').textContent).toBe('—');
    expect(c.querySelector('[data-slot="statGapLeaderSub"]').textContent).toBe(
      'completed 7 of 13 checks'
    );
  });

  it('drops the speed card and repurposes the gap chart for points per check', () => {
    const c = render(3279244);
    expect(c.querySelector('[data-slot="statSpeed"]')).toBeNull();
    expect(c.querySelector('[data-slot="chartSpeed"]')).toBeNull();
    const gapCard = c.querySelector('[data-slot="chartGap"]').closest('.card');
    expect(gapCard.querySelector('h2').textContent).toBe('Points dropped per check');
  });

  it('renders a points-oriented section table with one row per check', () => {
    const c = render(3279244);
    const headCells = Array.from(c.querySelectorAll('[data-slot="tableHead"] th')).map((th) =>
      th.textContent
    );
    expect(headCells).toEqual([
      'Check',
      'Points',
      'Cumulative points',
      'Emergency time',
      'Check rank (overall)',
      'Overall position',
      'Class position'
    ]);
    const rows = Array.from(c.querySelectorAll('[data-slot="tableBody"] tr'));
    expect(rows).toHaveLength(13);
    const check3 = Array.from(rows[2].querySelectorAll('td')).map((td) => td.textContent);
    expect(check3).toEqual(['Check 3', '11', '11', '10:56', '53', '53', '6']);
  });

  it('renders position charts for every check and a timed-only comparison chart', () => {
    const c = render(3279244);
    expect(c.querySelector('[data-slot="chartOverall"] svg')).not.toBeNull();
    expect(c.querySelector('[data-slot="chartClass"] svg')).not.toBeNull();
    const sectionChart = c.querySelector('[data-slot="chartSection"]');
    expect(sectionChart.querySelector('svg')).not.toBeNull();
  });

  it('never shows negative positions on chart axes', () => {
    const c = render(3279244);
    const ticks = Array.from(c.querySelectorAll('svg text.tick-label'))
      .map((t) => Number(t.textContent))
      .filter((n) => Number.isFinite(n));
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(0);
  });
});
