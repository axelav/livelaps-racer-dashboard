# LiveLaps Racer Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static Vite + vanilla JS webapp where anyone can paste a LiveLaps race link, pick themselves from a type-ahead, and get a shareable section-by-section breakdown dashboard (position trajectory, pace, gaps) — generalizing the one-off Axel Anderson artifact into a tool for any racer in any section-based (enduro) LiveLaps race.

**Architecture:** Single-page app, no backend, no framework. `main.js` reads `?race=&id=` query params and toggles between a search view (`search.js`) and a dashboard view (`dashboard.js`), using `history.pushState`/`popstate` for deep links. `livelaps.js` is the pure-logic + API layer (URL parsing, duration parsing, data derivation, fetch calls). `charts.js` holds reusable SVG chart primitives ported from the original single-racer artifact.

**Tech Stack:** Vite 8, Vitest 4, pnpm, vanilla JS (ES modules), hand-written SVG charts (no charting library), plain CSS with custom properties for light/dark theming.

---

## Reference: confirmed live API behavior

Everything below was verified against the production API during planning (not guessed):

- Base URL: `https://www.livelaps.com/laravel/public/api/v1/livelaps/`
- `race/{raceId}` → `{success, message: {Race_Name, RACE_MODE_NAME, ...}}`. `RACE_MODE_NAME` is `"Enduro"` for section-based races and e.g. `"Laps / Hare Scramble / Cross Country"` for lap-based ones — **this is the format-support check**, not the presence of a `sections` array (hare-scramble entries have a `sections` array too, just named `"Lap 1"`, `"Lap 2"`, ...).
- `race/results/{raceId}?page={n}&size={n}` → `{total, has_more_pages, data: [...]}`. Each entry has `id`, `fullName`, `displayedNumber`, `className`, `brand`, `avgSpeedTotal` (number), `overallPosition`, `classPosition`, `overallBehindByLeader`, `classBehindByLeader` (time strings, `""` for the leader), and `sections: [...]`. Each section has `sectionName`, `totalCumulatedTime`, `overallPosition`/`classPosition` (cumulative rank after this section), `sectionOverallPosition`/`sectionClassPosition` (that section's rank alone), `avgSpeed` (**string**, needs `parseFloat`), `overallBehindBy` (time string — gap to the rider immediately ahead, cumulative, after this section).
- `race/filters/{raceId}` → `{participants: [{value: <id>, text: "Full Name - BibNumber"}]}` — `value` is the same `id` used in `race/results`.
- `race/event/{eventId}` → `{success, message: [{id, raceName, mode, ...}]}` — the race(s) under an event. An `eventScores/{id}` URL carries an **Event ID**, a different ID space than race IDs (confirmed: calling `race/` directly with an event ID returns a completely unrelated race). Resolve via this endpoint first.
- Time strings are `"HH:MM:SS.mmm"` (e.g. `"00:44:39.165"`) or `""` (no gap, e.g. the leader).

Verified real fixture (Axel Anderson, race 79103, participant 4758874) reproduces every number from the original artifact exactly: overall 164/504, class 13/16 in "A 40+", 44:39 behind overall leader, 26:28 behind class leader, 16.1 mph average, section gap-ahead values `[2.349, 1.172, 5.768, 1.116, 23.151, 19.514]`.

---

## File structure

```
package.json
index.html
src/
  main.js        entry: URL routing, history wiring, ties search/dashboard together
  livelaps.js     pure logic (parseRaceId, parseDuration, formatDuration,
                  deriveTotals, deriveSectionSeries) + API layer (fetchRace,
                  fetchAllResults, fetchEventRaces, loadRaceById,
                  resolveAndLoadRace) + error classes
  charts.js       pure geometry (niceTicks, scaleY, roundedTopRectPath) +
                  SVG rendering (lineChart, barChart)
  search.js       race URL/ID input + type-ahead-over-participants UI
  dashboard.js    stat tiles + charts + table for one racer record
  style.css
test/
  livelaps.test.js
  charts.test.js
  fixtures/
    results.fixture.js
```

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize the package**

Run: `pnpm init` (from the repo root)
Expected: writes a default `package.json`.

- [ ] **Step 2: Install Vite and Vitest**

Run: `pnpm add -D vite vitest`
Expected: `devDependencies` gains `vite` and `vitest`; a `pnpm-lock.yaml` is created.

- [ ] **Step 3: Edit `package.json`**

Set the contents to:

```json
{
  "name": "livelaps-racer-dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "vite": "^8.1.4",
    "vitest": "^4.1.10"
  }
}
```

(Keep whatever exact versions `pnpm add` actually installed — check `package.json` after Step 2 and use those version numbers instead of the ones above if they differ.)

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
dist
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: scaffold vite + vitest project"
```

---

### Task 1: `index.html` and a placeholder `main.js`

**Files:**
- Create: `index.html`
- Create: `src/main.js`
- Create: `src/style.css`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Racer Breakdown — LiveLaps</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write a placeholder `src/style.css`**

```css
body {
  margin: 0;
}
```

- [ ] **Step 3: Write a placeholder `src/main.js`**

```js
import './style.css';

document.getElementById('app').textContent = 'Racer Breakdown — coming soon.';
```

- [ ] **Step 4: Verify the dev server serves it**

Run: `pnpm exec vite build`
Expected: `dist/index.html` and a bundled JS asset are produced, build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.js src/style.css
git commit -m "feat: add app shell"
```

---

### Task 2: `charts.js` — `niceTicks`

**Files:**
- Create: `src/charts.js`
- Create: `test/charts.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/charts.test.js
import { describe, it, expect } from 'vitest';
import { niceTicks } from '../src/charts.js';

describe('niceTicks', () => {
  it('produces round numbers spanning a normal range', () => {
    expect(niceTicks(130, 253, 4)).toEqual({
      min: 100,
      max: 300,
      ticks: [100, 150, 200, 250, 300]
    });
  });

  it('widens a degenerate (flat) domain instead of dividing by zero', () => {
    expect(niceTicks(13, 13, 4)).toEqual({
      min: 12,
      max: 14,
      ticks: [12, 12.5, 13, 13.5, 14]
    });
  });

  it('handles a small fractional range', () => {
    expect(niceTicks(14.5, 18.5, 4)).toEqual({
      min: 14,
      max: 20,
      ticks: [14, 16, 18, 20]
    });
  });

  it('handles a zero-based range', () => {
    expect(niceTicks(0, 23.5, 4)).toEqual({
      min: 0,
      max: 40,
      ticks: [0, 20, 40]
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run test/charts.test.js`
Expected: FAIL — `niceTicks is not a function` (or module not found), since `src/charts.js` doesn't exist yet.

- [ ] **Step 3: Implement `niceTicks` in `src/charts.js`**

```js
function niceNum(range, round) {
  const exponent = Math.floor(Math.log(range) / Math.LN10);
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

export function niceTicks(min, max, count) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { min: niceMin, max: niceMax, ticks };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/charts.test.js`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/charts.js test/charts.test.js
git commit -m "feat: add niceTicks chart axis helper"
```

---

### Task 3: `charts.js` — `scaleY`

**Files:**
- Modify: `src/charts.js`
- Modify: `test/charts.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `test/charts.test.js`:

```js
import { niceTicks, scaleY } from '../src/charts.js';

describe('scaleY', () => {
  const dMin = 130, dMax = 260, pxTop = 16, pxBottom = 194;

  it('maps the domain min to pxTop when inverted (lower value = higher on screen)', () => {
    expect(scaleY(130, dMin, dMax, pxTop, pxBottom, true)).toBe(16);
  });

  it('maps the domain max to pxBottom when inverted', () => {
    expect(scaleY(260, dMin, dMax, pxTop, pxBottom, true)).toBe(194);
  });

  it('maps a midpoint value correctly when inverted', () => {
    expect(scaleY(195, dMin, dMax, pxTop, pxBottom, true)).toBe(105);
  });

  it('maps the domain min to pxBottom when not inverted (bar chart baseline)', () => {
    expect(scaleY(130, dMin, dMax, pxTop, pxBottom, false)).toBe(194);
  });

  it('maps the domain max to pxTop when not inverted', () => {
    expect(scaleY(260, dMin, dMax, pxTop, pxBottom, false)).toBe(16);
  });
});
```

(Remove the now-duplicate `import { niceTicks } from '../src/charts.js';` at the top of the file so there's only one import line combining both names: `import { niceTicks, scaleY } from '../src/charts.js';`.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run test/charts.test.js`
Expected: FAIL — `scaleY is not a function`.

- [ ] **Step 3: Implement `scaleY`**

Append to `src/charts.js`:

```js
export function scaleY(v, dMin, dMax, pxTop, pxBottom, invert) {
  const t = (v - dMin) / (dMax - dMin);
  return invert ? pxTop + t * (pxBottom - pxTop) : pxBottom - t * (pxBottom - pxTop);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/charts.test.js`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/charts.js test/charts.test.js
git commit -m "feat: add scaleY chart coordinate helper"
```

---

### Task 4: `charts.js` — rendering functions (`roundedTopRectPath`, `lineChart`, `barChart`)

These are DOM/SVG-producing functions, ported and adapted from the original single-racer artifact (parameterized by `labels`/`values`/`series` instead of a hardcoded global). Per the design spec, DOM rendering is verified manually against the dev server rather than unit tested — the pure geometry (`niceTicks`, `scaleY`) is already covered.

**Files:**
- Modify: `src/charts.js`

- [ ] **Step 1: Append the shared SVG/tooltip helpers**

```js
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function cssVar(container, name) {
  return getComputedStyle(container).getPropertyValue(name).trim();
}

function makeTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  container.style.position = 'relative';
  container.appendChild(tip);
  return {
    show(build, x, y) {
      tip.innerHTML = '';
      build(tip);
      tip.classList.add('show');
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      let left = x + 14;
      if (left + tw > cw) left = x - tw - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, y - 10) + 'px';
    },
    hide() {
      tip.classList.remove('show');
    }
  };
}

function ttRow(parent, color, label, value) {
  const row = document.createElement('div');
  row.className = 'tt-row';
  if (color) {
    const key = document.createElement('span');
    key.className = 'tt-key';
    key.style.background = color;
    row.appendChild(key);
  }
  const lab = document.createElement('span');
  lab.textContent = label;
  row.appendChild(lab);
  const val = document.createElement('span');
  val.className = 'tt-val';
  val.textContent = value;
  row.appendChild(val);
  parent.appendChild(row);
}
```

- [ ] **Step 2: Append `roundedTopRectPath`**

```js
export function roundedTopRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return [
    'M', x, y + h,
    'L', x, y + r,
    'Q', x, y, x + r, y,
    'L', x + w - r, y,
    'Q', x + w, y, x + w, y + r,
    'L', x + w, y + h,
    'Z'
  ].join(' ');
}
```

- [ ] **Step 3: Append `lineChart`**

```js
export function lineChart(container, opts) {
  const W = 520, H = 220;
  const padL = 34, padR = 16, padT = 16, padB = 26;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const labels = opts.labels;
  const n = labels.length;

  const allVals = [];
  opts.series.forEach((s) => s.values.forEach((v) => allVals.push(v)));
  const dMin = Math.min(...allVals);
  const dMax = Math.max(...allVals);
  const pad = Math.max((dMax - dMin) * 0.25, 2);
  const domain = niceTicks(dMin - pad, dMax + pad, 4);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' });
  function xAt(i) {
    return plotL + (i / (n - 1)) * (plotR - plotL);
  }
  function yAt(v) {
    return scaleY(v, domain.min, domain.max, plotT, plotB, true);
  }

  domain.ticks.forEach((t) => {
    const y = yAt(t);
    if (y < plotT - 1 || y > plotB + 1) return;
    svg.appendChild(el('line', { class: 'grid-line', x1: plotL, x2: plotR, y1: y, y2: y }));
    const lbl = el('text', { class: 'tick-label', x: plotL - 8, y: y + 3, 'text-anchor': 'end' });
    lbl.textContent = String(Math.round(t));
    svg.appendChild(lbl);
  });
  svg.appendChild(el('line', { class: 'axis-line', x1: plotL, x2: plotL, y1: plotT, y2: plotB }));

  labels.forEach((_, i) => {
    const lbl = el('text', { class: 'tick-label', x: xAt(i), y: H - 8, 'text-anchor': 'middle' });
    lbl.textContent = `S${i + 1}`;
    svg.appendChild(lbl);
  });

  const crosshair = el('line', { class: 'crosshair', x1: 0, x2: 0, y1: plotT, y2: plotB, opacity: 0 });

  opts.series.forEach((s) => {
    const d = s.values.map((v, i) => (i === 0 ? 'M' : 'L') + xAt(i) + ',' + yAt(v)).join(' ');
    svg.appendChild(
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
    );
    s.values.forEach((v, i) => {
      svg.appendChild(
        el('circle', { class: 'pt', cx: xAt(i), cy: yAt(v), r: 4, fill: s.color, stroke: cssVar(container, '--surface-1'), 'stroke-width': 2 })
      );
    });
    const lastI = s.values.length - 1;
    const endLabel = el('text', { class: 'end-label', x: xAt(lastI) + 8, y: yAt(s.values[lastI]) - 8, 'text-anchor': 'start' });
    endLabel.textContent = Math.round(s.values[lastI]) + (opts.suffix || '');
    svg.appendChild(endLabel);
  });

  svg.appendChild(crosshair);
  const overlay = el('rect', { class: 'hit', x: plotL, y: plotT, width: plotR - plotL, height: plotB - plotT });
  svg.appendChild(overlay);

  container.innerHTML = '';
  container.appendChild(svg);
  const tooltip = makeTooltip(container);

  function pointerToIndex(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - plotL) / (plotR - plotL)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  function showAt(i) {
    const x = xAt(i);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('opacity', 1);
    const contRect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const localX = (x / W) * svgRect.width + (svgRect.left - contRect.left);
    const localY = svgRect.top - contRect.top;
    tooltip.show((tip) => {
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = labels[i];
      tip.appendChild(title);
      opts.series.forEach((s) => {
        ttRow(tip, s.color, s.name, Math.round(s.values[i]) + (opts.suffix || ''));
      });
    }, localX, localY);
  }

  overlay.addEventListener('pointermove', (evt) => showAt(pointerToIndex(evt)));
  overlay.addEventListener('pointerleave', () => {
    crosshair.setAttribute('opacity', 0);
    tooltip.hide();
  });
}
```

- [ ] **Step 4: Append `barChart`**

```js
export function barChart(container, opts) {
  const W = 520, H = 220;
  const padL = 34, padR = 16, padT = 20, padB = 26;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const values = opts.values;
  const labels = opts.labels;
  const n = values.length;
  const dMax = Math.max(...values);
  const domain = niceTicks(0, dMax * 1.15, 4);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' });
  const bandW = (plotR - plotL) / n;
  const barW = Math.min(28, bandW * 0.5);

  domain.ticks.forEach((t) => {
    const y = scaleY(t, domain.min, domain.max, plotT, plotB, false);
    svg.appendChild(el('line', { class: 'grid-line', x1: plotL, x2: plotR, y1: y, y2: y }));
    const lbl = el('text', { class: 'tick-label', x: plotL - 8, y: y + 3, 'text-anchor': 'end' });
    lbl.textContent = String(Math.round(t * 10) / 10);
    svg.appendChild(lbl);
  });
  svg.appendChild(el('line', { class: 'axis-line', x1: plotL, x2: plotR, y1: plotB, y2: plotB }));

  container.innerHTML = '';
  container.appendChild(svg);
  const tooltip = makeTooltip(container);

  values.forEach((v, i) => {
    const cx = plotL + bandW * (i + 0.5);
    const y = scaleY(v, domain.min, domain.max, plotT, plotB, false);
    const h = plotB - y;
    const path = el('path', {
      class: 'bar',
      d: roundedTopRectPath(cx - barW / 2, y, barW, h, 4),
      fill: opts.color,
      tabindex: '0',
      role: 'img',
      'aria-label': `${labels[i]}: ${opts.format(v)}`
    });
    svg.appendChild(path);

    const cap = el('text', { class: 'tick-label', x: cx, y: y - 6, 'text-anchor': 'middle' });
    cap.textContent = opts.format(v);
    cap.setAttribute('fill', cssVar(container, '--text-secondary'));
    svg.appendChild(cap);

    const xl = el('text', { class: 'tick-label', x: cx, y: H - 8, 'text-anchor': 'middle' });
    xl.textContent = `S${i + 1}`;
    svg.appendChild(xl);

    function show() {
      const contRect = container.getBoundingClientRect();
      const pathRect = path.getBoundingClientRect();
      tooltip.show((tip) => {
        const title = document.createElement('div');
        title.className = 'tt-title';
        title.textContent = labels[i];
        tip.appendChild(title);
        ttRow(tip, opts.color, opts.label, opts.format(v));
      }, pathRect.left - contRect.left, pathRect.top - contRect.top);
    }
    path.addEventListener('pointerenter', show);
    path.addEventListener('pointermove', show);
    path.addEventListener('focus', show);
    path.addEventListener('pointerleave', tooltip.hide);
    path.addEventListener('blur', tooltip.hide);
  });
}
```

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `pnpm test`
Expected: PASS — all existing tests (9) still pass; `lineChart`/`barChart` have no dedicated tests (DOM rendering, verified manually in Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/charts.js
git commit -m "feat: add lineChart and barChart SVG renderers"
```

---

### Task 5: `livelaps.js` — `parseRaceId`

**Files:**
- Create: `src/livelaps.js`
- Create: `test/livelaps.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/livelaps.test.js
import { describe, it, expect } from 'vitest';
import { parseRaceId } from '../src/livelaps.js';

describe('parseRaceId', () => {
  it('accepts a bare race ID', () => {
    expect(parseRaceId('79103')).toEqual({ id: 79103, isEvent: false });
  });

  it('trims whitespace around a bare race ID', () => {
    expect(parseRaceId('  79103  ')).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/results/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/results/79103?page=1&size=1000')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/filters/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/filters/79103')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/config/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/config/79103')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a bare race/ URL', () => {
    expect(parseRaceId('https://www.livelaps.com/livelaps/race/79103')).toEqual({ id: 79103, isEvent: false });
  });

  it('parses an eventScores/ URL and tags it as an event ID', () => {
    expect(parseRaceId('https://www.livelaps.com/livelaps/eventScores/23827')).toEqual({
      id: 23827,
      isEvent: true
    });
  });

  it('returns null for garbage input', () => {
    expect(parseRaceId('not a race id')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseRaceId('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseRaceId('   ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: FAIL — `src/livelaps.js` doesn't exist yet.

- [ ] **Step 3: Implement `parseRaceId` in `src/livelaps.js`**

```js
const RACE_ID_PATTERNS = [/race\/results\/(\d+)/, /race\/filters\/(\d+)/, /race\/config\/(\d+)/, /race\/(\d+)/];
const EVENT_ID_PATTERN = /eventScores\/(\d+)/;

export function parseRaceId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const eventMatch = trimmed.match(EVENT_ID_PATTERN);
  if (eventMatch) return { id: Number(eventMatch[1]), isEvent: true };

  for (const pattern of RACE_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return { id: Number(match[1]), isEvent: false };
  }

  if (/^\d+$/.test(trimmed)) return { id: Number(trimmed), isEvent: false };

  return null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/livelaps.js test/livelaps.test.js
git commit -m "feat: add parseRaceId URL/ID resolver"
```

---

### Task 6: `livelaps.js` — `parseDuration` and `formatDuration`

**Files:**
- Modify: `src/livelaps.js`
- Modify: `test/livelaps.test.js`

- [ ] **Step 1: Append the failing tests**

```js
import { parseRaceId, parseDuration, formatDuration } from '../src/livelaps.js';

describe('parseDuration', () => {
  it('parses an HH:MM:SS.mmm string into seconds', () => {
    expect(parseDuration('00:44:39.165')).toBeCloseTo(2679.165, 3);
  });

  it('parses a sub-minute gap', () => {
    expect(parseDuration('00:00:23.151')).toBeCloseTo(23.151, 3);
  });

  it('treats an empty string (no gap, e.g. the leader) as zero', () => {
    expect(parseDuration('')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats minutes:seconds under an hour', () => {
    expect(formatDuration(2679.165)).toBe('44:39');
  });

  it('formats a second example matching the class-leader gap', () => {
    expect(formatDuration(1588.18)).toBe('26:28');
  });

  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats an hour-plus duration with an hours segment', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
```

(Update the top import line to combine with the existing `parseRaceId` import: `import { parseRaceId, parseDuration, formatDuration } from '../src/livelaps.js';`.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: FAIL — `parseDuration is not a function`.

- [ ] **Step 3: Implement both functions**

Append to `src/livelaps.js`:

```js
export function parseDuration(value) {
  if (!value) return 0;
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: PASS — 17 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/livelaps.js test/livelaps.test.js
git commit -m "feat: add duration parsing/formatting helpers"
```

---

### Task 7: `livelaps.js` — `deriveTotals` and `deriveSectionSeries`

**Files:**
- Modify: `src/livelaps.js`
- Create: `test/fixtures/results.fixture.js`
- Modify: `test/livelaps.test.js`

- [ ] **Step 1: Write the fixture**

This is Axel Anderson's real entry from race 79103 (fetched live during planning), trimmed to the fields the app uses, embedded in a small synthetic field so `deriveTotals` has something to count against.

```js
// test/fixtures/results.fixture.js
export const AXEL_ENTRY = {
  id: 4758874,
  fullName: 'Axel Anderson',
  displayedNumber: '34D',
  brand: 'Husqvarna',
  className: 'A 40+',
  avgSpeedTotal: 16.073,
  overallPosition: 164,
  classPosition: 13,
  overallBehindByLeader: '00:44:39.165',
  classBehindByLeader: '00:26:28.180',
  sections: [
    {
      sectionName: 'Section 1',
      totalCumulatedTime: '00:22:36.309',
      overallPosition: 237,
      classPosition: 14,
      sectionOverallPosition: 237,
      sectionClassPosition: 14,
      avgSpeed: '15.929',
      overallBehindBy: '00:00:02.349'
    },
    {
      sectionName: 'Section 2',
      totalCumulatedTime: '00:48:52.458',
      overallPosition: 242,
      classPosition: 13,
      sectionOverallPosition: 245,
      sectionClassPosition: 13,
      avgSpeed: '15.990',
      overallBehindBy: '00:00:01.172'
    },
    {
      sectionName: 'Section 3',
      totalCumulatedTime: '01:03:50.018',
      overallPosition: 240,
      classPosition: 13,
      sectionOverallPosition: 257,
      sectionClassPosition: 15,
      avgSpeed: '16.054',
      overallBehindBy: '00:00:05.768'
    },
    {
      sectionName: 'Section 4',
      totalCumulatedTime: '01:16:58.394',
      overallPosition: 253,
      classPosition: 13,
      sectionOverallPosition: 329,
      sectionClassPosition: 15,
      avgSpeed: '18.274',
      overallBehindBy: '00:00:01.116'
    },
    {
      sectionName: 'Section 5',
      totalCumulatedTime: '01:45:54.475',
      overallPosition: 239,
      classPosition: 13,
      sectionOverallPosition: 264,
      sectionClassPosition: 13,
      avgSpeed: '15.553',
      overallBehindBy: '00:00:23.151'
    },
    {
      sectionName: 'Section 6',
      totalCumulatedTime: '02:26:53.649',
      overallPosition: 164,
      classPosition: 13,
      sectionOverallPosition: 200,
      sectionClassPosition: 13,
      avgSpeed: '14.640',
      overallBehindBy: '00:00:19.514'
    }
  ]
};

export const RESULTS_FIXTURE = [
  { id: 1, className: 'Pro' },
  { id: 2, className: 'A 40+' },
  AXEL_ENTRY,
  { id: 4, className: 'A 40+' },
  { id: 5, className: 'Pro' }
];
```

- [ ] **Step 2: Append the failing tests**

```js
import { deriveTotals, deriveSectionSeries } from '../src/livelaps.js';
import { AXEL_ENTRY, RESULTS_FIXTURE } from './fixtures/results.fixture.js';

describe('deriveTotals', () => {
  it('finds the racer and computes field/class size from the full results array', () => {
    expect(deriveTotals(RESULTS_FIXTURE, 4758874)).toEqual({
      racer: AXEL_ENTRY,
      fieldSize: 5,
      classSize: 3
    });
  });

  it('returns null when the participant id is not in this race', () => {
    expect(deriveTotals(RESULTS_FIXTURE, 999999)).toBeNull();
  });
});

describe('deriveSectionSeries', () => {
  it('maps every section field into a parallel array, matching the known-good artifact values', () => {
    expect(deriveSectionSeries(AXEL_ENTRY)).toEqual({
      names: ['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5', 'Section 6'],
      cumTimes: [
        '00:22:36.309',
        '00:48:52.458',
        '01:03:50.018',
        '01:16:58.394',
        '01:45:54.475',
        '02:26:53.649'
      ],
      cumulativeOverallPositions: [237, 242, 240, 253, 239, 164],
      cumulativeClassPositions: [14, 13, 13, 13, 13, 13],
      sectionOnlyOverallRanks: [237, 245, 257, 329, 264, 200],
      sectionOnlyClassRanks: [14, 13, 15, 15, 13, 13],
      avgSpeeds: [15.929, 15.99, 16.054, 18.274, 15.553, 14.64],
      gapAheadSeconds: [2.349, 1.172, 5.768, 1.116, 23.151, 19.514]
    });
  });
});
```

(Update the top import for `../src/livelaps.js` and `./fixtures/results.fixture.js` to sit alongside the existing imports at the top of the file.)

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: FAIL — `deriveTotals is not a function`.

- [ ] **Step 4: Implement both functions**

Append to `src/livelaps.js`:

```js
export function deriveTotals(allResults, participantId) {
  const racer = allResults.find((r) => r.id === participantId);
  if (!racer) return null;
  const classSize = allResults.filter((r) => r.className === racer.className).length;
  return { racer, fieldSize: allResults.length, classSize };
}

export function deriveSectionSeries(racer) {
  const sections = racer.sections;
  return {
    names: sections.map((s) => s.sectionName),
    cumTimes: sections.map((s) => s.totalCumulatedTime),
    cumulativeOverallPositions: sections.map((s) => s.overallPosition),
    cumulativeClassPositions: sections.map((s) => s.classPosition),
    sectionOnlyOverallRanks: sections.map((s) => s.sectionOverallPosition),
    sectionOnlyClassRanks: sections.map((s) => s.sectionClassPosition),
    avgSpeeds: sections.map((s) => parseFloat(s.avgSpeed)),
    gapAheadSeconds: sections.map((s) => parseDuration(s.overallBehindBy))
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/livelaps.test.js`
Expected: PASS — 20 tests passed.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: PASS — 29 tests passed (20 in livelaps.test.js + 9 in charts.test.js).

- [ ] **Step 7: Commit**

```bash
git add src/livelaps.js test/livelaps.test.js test/fixtures/results.fixture.js
git commit -m "feat: add deriveTotals and deriveSectionSeries"
```

---

### Task 8: `livelaps.js` — API layer and error classes

Fetch/network functions aren't unit tested (per the design spec: thin client over a third-party API, verified manually in Task 13). This task wires them together with the pure functions from Tasks 5–7.

**Files:**
- Modify: `src/livelaps.js`

- [ ] **Step 1: Append the error classes and API base**

Add near the top of `src/livelaps.js` (after the existing pattern constants, before `parseRaceId`, is fine — order doesn't matter for `export`s):

```js
const API_BASE = 'https://www.livelaps.com/laravel/public/api/v1/livelaps/';

export class UnparseableInputError extends Error {}
export class MultiRaceEventError extends Error {}
export class UnsupportedFormatError extends Error {}
```

- [ ] **Step 2: Append the fetch functions**

```js
async function apiGet(path) {
  const response = await fetch(API_BASE + path);
  if (!response.ok) {
    throw new Error(`LiveLaps API request failed: ${response.status} ${path}`);
  }
  return response.json();
}

export async function fetchRace(raceId) {
  const json = await apiGet(`race/${raceId}`);
  return { raceName: json.message.Race_Name, modeName: json.message.RACE_MODE_NAME };
}

export async function fetchAllResults(raceId) {
  let page = 1;
  let all = [];
  while (true) {
    const json = await apiGet(`race/results/${raceId}?page=${page}&size=1000`);
    all = all.concat(json.data);
    if (!json.has_more_pages) break;
    page += 1;
  }
  return all;
}

export async function fetchEventRaces(eventId) {
  const json = await apiGet(`race/event/${eventId}`);
  return json.message;
}
```

- [ ] **Step 3: Append the orchestration functions**

```js
export async function loadRaceById(raceId) {
  const [raceMeta, allResults] = await Promise.all([fetchRace(raceId), fetchAllResults(raceId)]);
  if (raceMeta.modeName !== 'Enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Racer Breakdown currently works with section-based (enduro) races."
    );
  }
  return { raceId, raceMeta, allResults };
}

export async function resolveAndLoadRace(input) {
  const parsed = parseRaceId(input);
  if (!parsed) {
    throw new UnparseableInputError(
      "Couldn't find a race ID in that — try pasting a LiveLaps race/results/event URL, or just the number."
    );
  }

  let raceId = parsed.id;
  if (parsed.isEvent) {
    const races = await fetchEventRaces(parsed.id);
    if (races.length !== 1) {
      throw new MultiRaceEventError(
        "This event has multiple races — paste the link for the specific race's results instead."
      );
    }
    raceId = races[0].id;
  }

  return loadRaceById(raceId);
}
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `pnpm test`
Expected: PASS — 29 tests passed (the new functions have no dedicated tests; they're network-dependent and covered by manual verification in Task 13).

- [ ] **Step 5: Commit**

```bash
git add src/livelaps.js
git commit -m "feat: add LiveLaps API layer with race/event resolution"
```

---

### Task 9: `style.css`

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Replace `src/style.css` with the full stylesheet**

Ported from the original artifact's design tokens, adapted for a full page (not an embedded iframe card) and extended with the search-view elements (`.race-form`, `.notice`, `.form-error`, `.participant-list`, `.back-link`) that weren't in the original single-racer artifact.

```css
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.viz-root {
  --surface-1: #fcfcfb;
  --page: #f9f9f7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --grid: #e1e0d9;
  --axis: #c3c2b7;
  --border: rgba(11, 11, 11, 0.1);
  --series-overall: #2a78d6;
  --series-class: #1baf7a;
  --series-section: #4a3aa7;
  --series-speed: #eda100;
  --series-gap: #eb6834;
  --good: #006300;
  --error: #b3261e;
  background: var(--page);
  color: var(--text-primary);
}

@media (prefers-color-scheme: dark) {
  .viz-root {
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --grid: #2c2c2a;
    --axis: #383835;
    --border: rgba(255, 255, 255, 0.1);
    --series-overall: #3987e5;
    --series-class: #199e70;
    --series-section: #9085e9;
    --series-speed: #c98500;
    --series-gap: #d95926;
    --good: #0ca30c;
    --error: #ff6b60;
  }
}

.viz-root * {
  box-sizing: border-box;
}

.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}

.masthead {
  margin-bottom: 24px;
}
.eyebrow {
  font-size: 13px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 6px;
}
h1 {
  font-size: 28px;
  font-weight: 650;
  margin: 0 0 6px;
}
.subhead {
  font-size: 15px;
  color: var(--text-secondary);
  margin: 0;
}
.subhead b {
  color: var(--text-primary);
  font-weight: 600;
}

.back-link {
  background: none;
  border: none;
  padding: 0;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}
.back-link:hover {
  color: var(--text-primary);
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 24px 0 28px;
}
.stat-tile {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
.stat-label {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 6px;
}
.stat-value {
  font-size: 24px;
  font-weight: 650;
  margin: 0;
}
.stat-value small {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}
.stat-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 4px 0 0;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px 18px 12px;
  position: relative;
}
.card.full {
  grid-column: 1 / -1;
}
.card h2 {
  font-size: 15px;
  font-weight: 650;
  margin: 0 0 2px;
}
.card .card-sub {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 0 0 10px;
}
.card svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.legend {
  display: flex;
  gap: 16px;
  margin: 0 0 8px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.legend-key {
  width: 14px;
  height: 2px;
  border-radius: 1px;
  display: inline-block;
}

.tick-label {
  fill: var(--text-muted);
  font-size: 10.5px;
}
.axis-line {
  stroke: var(--axis);
  stroke-width: 1;
}
.grid-line {
  stroke: var(--grid);
  stroke-width: 1;
}
.end-label {
  fill: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
}

.tooltip {
  position: absolute;
  pointer-events: none;
  z-index: 5;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  opacity: 0;
  transition: opacity 0.08s ease;
  white-space: nowrap;
}
.tooltip.show {
  opacity: 1;
}
.tooltip .tt-title {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.tooltip .tt-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tooltip .tt-key {
  width: 10px;
  height: 2px;
  display: inline-block;
  border-radius: 1px;
}
.tooltip .tt-val {
  color: var(--text-primary);
  font-weight: 650;
  margin-left: auto;
  padding-left: 10px;
}

.hit {
  fill: transparent;
  cursor: crosshair;
}
.crosshair {
  stroke: var(--axis);
  stroke-width: 1;
  pointer-events: none;
}
.pt {
  transition: r 0.08s ease;
}
.bar {
  cursor: pointer;
}
.bar:hover,
.bar:focus {
  filter: brightness(1.08);
}
.bar:focus {
  outline: none;
}

details.table-toggle {
  margin-top: 20px;
}
details.table-toggle > summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 600;
  padding: 10px 2px;
  list-style: none;
}
details.table-toggle > summary::-webkit-details-marker {
  display: none;
}
details.table-toggle > summary::before {
  content: '▸ ';
  color: var(--text-muted);
}
details.table-toggle[open] > summary::before {
  content: '▾ ';
}
table.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin-top: 8px;
}
table.data-table th,
table.data-table td {
  text-align: right;
  padding: 7px 10px;
  border-bottom: 1px solid var(--grid);
  font-variant-numeric: tabular-nums;
}
table.data-table th:first-child,
table.data-table td:first-child {
  text-align: left;
  font-variant-numeric: normal;
}
table.data-table th {
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11.5px;
}

.race-form {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.race-form input,
[data-slot='participantInput'] {
  flex: 1;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--text-primary);
}
.race-form button {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  background: var(--series-overall);
  color: white;
  cursor: pointer;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 16px;
}
.notice p {
  margin: 0;
  flex: 1;
}
.notice button {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.notice button:hover {
  color: var(--text-primary);
}
.form-error {
  font-size: 13px;
  color: var(--error);
  margin: 8px 0;
}

.participant-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.participant-list li {
  border-bottom: 1px solid var(--grid);
}
.participant-list li:last-child {
  border-bottom: none;
}
.participant-list button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  font-size: 13.5px;
  color: var(--text-primary);
  background: none;
  border: none;
  cursor: pointer;
}
.participant-list button:hover {
  background: var(--grid);
}

@media (max-width: 720px) {
  .stat-row {
    grid-template-columns: 1fr 1fr;
  }
  .grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `pnpm exec vite build`
Expected: build succeeds, `dist/assets/*.css` is produced.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: add app stylesheet with light/dark theming"
```

---

### Task 10: `dashboard.js`

**Files:**
- Create: `src/dashboard.js`

- [ ] **Step 1: Write `src/dashboard.js`**

All racer/race-derived strings are set via `.textContent`/`.append(text)`, never interpolated into `innerHTML`, since `fullName`, `className`, `raceName`, etc. originate from a third-party API and must not be treated as trusted markup.

```js
import { lineChart, barChart } from './charts.js';
import { deriveSectionSeries, formatDuration, parseDuration } from './livelaps.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <button class="back-link" type="button" data-slot="back">&larr; Search another racer</button>
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

      <details class="table-toggle">
        <summary>View section-by-section data as a table</summary>
        <table class="data-table" data-slot="table">
          <thead>
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
      </details>
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

export function renderDashboard(container, { raceMeta, racer, fieldSize, classSize, onBack }) {
  container.innerHTML = TEMPLATE;
  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);

  slot('back').addEventListener('click', onBack);

  slot('eyebrow').textContent = raceMeta.raceName;
  slot('title').textContent = `${racer.fullName} — race breakdown`;

  const series = deriveSectionSeries(racer);
  const sectionCount = series.names.length;

  const subhead = slot('subhead');
  subhead.innerHTML = '';
  const boldBrand = document.createElement('b');
  boldBrand.textContent = `${racer.brand} #${racer.displayedNumber}`;
  subhead.appendChild(boldBrand);
  subhead.appendChild(
    document.createTextNode(
      ` · Class ${racer.className} · finished in ${series.cumTimes[sectionCount - 1]} across ${sectionCount} timed sections`
    )
  );

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

  slot('statGapLeader').textContent = formatDuration(parseDuration(racer.overallBehindByLeader));
  slot('statGapLeaderSub').textContent = `behind class leader by ${formatDuration(parseDuration(racer.classBehindByLeader))}`;

  const statSpeed = slot('statSpeed');
  statSpeed.innerHTML = '';
  statSpeed.append(`${racer.avgSpeedTotal.toFixed(1)} `);
  const speedSmall = document.createElement('small');
  speedSmall.textContent = 'mph';
  statSpeed.appendChild(speedSmall);
  slot('statSpeedSub').textContent = `across all ${sectionCount} sections`;

  slot('overallCardSub').textContent = `Cumulative position among all ${fieldSize} finishers, after each section`;
  slot('classCardSub').textContent = `Cumulative position within ${racer.className} (${classSize} riders), after each section`;

  const root = container.querySelector('.viz-root');
  const styles = getComputedStyle(root);
  const colorOverall = styles.getPropertyValue('--series-overall').trim();
  const colorClass = styles.getPropertyValue('--series-class').trim();
  const colorSection = styles.getPropertyValue('--series-section').trim();
  const colorSpeed = styles.getPropertyValue('--series-speed').trim();
  const colorGap = styles.getPropertyValue('--series-gap').trim();

  lineChart(slot('chartOverall'), {
    ariaLabel: 'Overall position by section',
    labels: series.names,
    series: [{ name: 'Overall position', color: colorOverall, values: series.cumulativeOverallPositions }]
  });

  lineChart(slot('chartClass'), {
    ariaLabel: 'Class position by section',
    labels: series.names,
    series: [{ name: 'Class position', color: colorClass, values: series.cumulativeClassPositions }]
  });

  buildLegend(slot('legendSection'), [
    { name: 'Cumulative overall position', color: colorOverall },
    { name: "That section's rank alone", color: colorSection }
  ]);
  lineChart(slot('chartSection'), {
    ariaLabel: 'Cumulative position vs section-only rank',
    labels: series.names,
    series: [
      { name: 'Cumulative overall position', color: colorOverall, values: series.cumulativeOverallPositions },
      { name: 'Section-only rank', color: colorSection, values: series.sectionOnlyOverallRanks }
    ]
  });

  barChart(slot('chartSpeed'), {
    ariaLabel: 'Average speed by section',
    labels: series.names,
    values: series.avgSpeeds,
    color: colorSpeed,
    label: 'Avg speed',
    format: (v) => v.toFixed(1)
  });

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
      series.avgSpeeds[i].toFixed(3),
      series.gapAheadSeconds[i].toFixed(3)
    ].forEach((val) => {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `pnpm test`
Expected: PASS — 29 tests passed (no new automated tests; DOM rendering is covered in Task 13's manual pass).

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: add dashboard rendering"
```

---

### Task 11: `search.js`

**Files:**
- Create: `src/search.js`

- [ ] **Step 1: Write `src/search.js`**

```js
import {
  resolveAndLoadRace,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './livelaps.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <div class="masthead">
        <p class="eyebrow">Racer Breakdown</p>
        <h1>Find your race result</h1>
        <p class="subhead">Paste a LiveLaps race link (results, filters, or event page) or a bare race ID.</p>
      </div>

      <div class="notice" data-slot="notice" hidden>
        <p data-slot="noticeText"></p>
        <button type="button" data-slot="noticeDismiss" aria-label="Dismiss">&times;</button>
      </div>

      <form data-slot="raceForm" class="race-form">
        <input type="text" data-slot="raceInput" placeholder="https://www.livelaps.com/... or 79103" autocomplete="off" />
        <button type="submit">Look up race</button>
      </form>

      <p class="form-error" data-slot="raceError" hidden></p>

      <div data-slot="participantSection" hidden>
        <p class="card-sub" data-slot="raceName"></p>
        <input type="text" data-slot="participantInput" placeholder="Search by name or bib number" autocomplete="off" />
        <p class="form-error" data-slot="participantError" hidden></p>
        <ul class="participant-list" data-slot="participantList"></ul>
      </div>
    </div>
  </div>
`;

export function renderSearch(container, { prefillRaceInput, notice, onSelect } = {}) {
  container.innerHTML = TEMPLATE;
  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);

  if (notice) {
    slot('noticeText').textContent = notice;
    slot('notice').hidden = false;
  }
  slot('noticeDismiss').addEventListener('click', () => {
    slot('notice').hidden = true;
  });
  if (prefillRaceInput) {
    slot('raceInput').value = prefillRaceInput;
  }

  let allResults = [];
  let currentRaceId = null;

  slot('raceForm').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const input = slot('raceInput').value;
    const errorEl = slot('raceError');
    errorEl.hidden = true;
    slot('participantSection').hidden = true;

    try {
      const { raceId, raceMeta, allResults: results } = await resolveAndLoadRace(input);
      allResults = results;
      currentRaceId = raceId;
      slot('raceName').textContent = raceMeta.raceName;
      slot('participantSection').hidden = false;
      slot('participantInput').value = '';
      slot('participantList').innerHTML = '';
      slot('participantInput').focus();
    } catch (err) {
      console.error(err);
      if (
        err instanceof UnparseableInputError ||
        err instanceof MultiRaceEventError ||
        err instanceof UnsupportedFormatError
      ) {
        errorEl.textContent = err.message;
      } else {
        errorEl.textContent = "Couldn't load that race — check the link and try again.";
      }
      errorEl.hidden = false;
    }
  });

  function renderMatches(query) {
    const list = slot('participantList');
    list.innerHTML = '';
    const errorEl = slot('participantError');
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) {
      errorEl.hidden = true;
      return;
    }

    const matches = allResults.filter(
      (r) => r.fullName.toLowerCase().includes(trimmed) || r.displayedNumber.toLowerCase().includes(trimmed)
    );

    if (matches.length === 0) {
      errorEl.textContent = `No one matches '${query}' in this race.`;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    matches.forEach((r) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${r.fullName} - ${r.displayedNumber}`;
      button.addEventListener('click', () => onSelect(currentRaceId, r.id));
      li.appendChild(button);
      list.appendChild(li);
    });
  }

  slot('participantInput').addEventListener('input', (evt) => renderMatches(evt.target.value));
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `pnpm test`
Expected: PASS — 29 tests passed.

- [ ] **Step 3: Commit**

```bash
git add src/search.js
git commit -m "feat: add search view with race lookup and participant type-ahead"
```

---

### Task 12: `main.js` — routing and history wiring

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Replace `src/main.js`**

```js
import './style.css';
import { loadRaceById, deriveTotals, UnsupportedFormatError } from './livelaps.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';

const app = document.getElementById('app');

function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return { raceId: params.get('race'), participantId: params.get('id') };
}

function showSearch(options = {}) {
  renderSearch(app, {
    ...options,
    onSelect(raceId, participantId) {
      history.pushState({}, '', `?race=${raceId}&id=${participantId}`);
      showDashboard(raceId, participantId);
    }
  });
}

function showSearchDefault() {
  history.pushState({}, '', window.location.pathname);
  showSearch();
}

async function showDashboard(raceId, participantId) {
  try {
    const { raceMeta, allResults } = await loadRaceById(raceId);
    const totals = deriveTotals(allResults, Number(participantId));
    if (!totals) {
      showSearch({ prefillRaceInput: raceId, notice: "Couldn't find that racer in this race." });
      return;
    }
    renderDashboard(app, { raceMeta, ...totals, onBack: showSearchDefault });
  } catch (err) {
    console.error(err);
    const message = err instanceof UnsupportedFormatError ? err.message : "Couldn't load that race.";
    showSearch({ prefillRaceInput: raceId, notice: message });
  }
}

function route() {
  const { raceId, participantId } = currentParams();
  if (raceId && participantId) {
    showDashboard(raceId, participantId);
  } else {
    showSearch();
  }
}

window.addEventListener('popstate', route);
route();
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: PASS — 29 tests passed.

- [ ] **Step 3: Verify the production build succeeds**

Run: `pnpm exec vite build`
Expected: build succeeds with no errors; `dist/` contains `index.html` and bundled assets.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: wire up routing between search and dashboard views"
```

---

### Task 13: Manual verification pass

Per the design spec, the search/dashboard toggle, error states, and light/dark rendering are verified manually against the dev server — there's no DOM/e2e automation in this project.

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: prints a local URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Verify the happy path (known-good race/racer)**

In a browser, open the dev server URL. Paste `79103` into the race input, submit, then search "Anderson" or "34D" in the participant box and select **Axel Anderson - 34D**.
Expected: dashboard renders with overall position **164 / 504**, class position **13 / 16**, gap to overall leader **44:39**, average speed **16.1 mph** — matching the original artifact exactly. All 5 charts render with visible data and working hover tooltips. The URL bar now shows `?race=79103&id=4758874`.

- [ ] **Step 3: Verify deep linking**

Copy the URL from Step 2, open it in a new tab (or reload the page).
Expected: the dashboard renders directly, skipping the search screen.

- [ ] **Step 4: Verify the back button and browser history**

From the dashboard, click "← Search another racer". Then use the browser's back button.
Expected: clicking the link returns to the search screen and clears the URL's query params; the browser back button correctly restores prior states via `popstate`.

- [ ] **Step 5: Verify the `race/results/` URL shape**

Paste `https://www.livelaps.com/laravel/public/api/v1/livelaps/race/results/79103?page=1&size=1000` into the race input instead of the bare number.
Expected: resolves to the same race as Step 2.

- [ ] **Step 6: Verify the `eventScores` URL shape (single-race event)**

Paste `https://www.livelaps.com/livelaps/eventScores/23827`.
Expected: resolves transparently to race 79103 (same race as above) — confirms the event→race ID resolution works.

- [ ] **Step 7: Verify the unparseable-input error**

Paste `not a race id at all` into the race input.
Expected: inline error — "Couldn't find a race ID in that — try pasting a LiveLaps race/results/event URL, or just the number."

- [ ] **Step 8: Verify the unsupported-format error**

Paste `23827` (note: this is a *race* ID here, not an event ID — it happens to be the Red Bull Outliers hare-scramble race, confirmed live to have `RACE_MODE_NAME` of `"Laps / Hare Scramble / Cross Country"`).
Expected: inline error — "This race format isn't supported yet — Racer Breakdown currently works with section-based (enduro) races."

- [ ] **Step 9: Verify the no-matches error**

With race 79103 loaded, type `zzzznomatch` into the participant search box.
Expected: "No one matches 'zzzznomatch' in this race."

- [ ] **Step 10: Verify the bad-race-fetch error**

Paste `999999999` (a race ID unlikely to exist).
Expected: inline error — "Couldn't load that race — check the link and try again." (not a raw stack trace or JSON dump).

- [ ] **Step 11: Verify a deep link with a bad participant id falls back gracefully**

Manually visit `<dev-server-url>/?race=79103&id=1`.
Expected: falls back to the search screen (prefilled with `79103` in the race input) with a notice: "Couldn't find that racer in this race." Click the notice's × button and confirm it disappears.

- [ ] **Step 12: Verify light and dark rendering**

Toggle the OS/browser color scheme (or devtools' rendering emulation) between light and dark while the dashboard is open.
Expected: background, text, chart colors, and tooltips all switch correctly with no unreadable/low-contrast states.

- [ ] **Step 13: Run the full automated suite one more time**

Run: `pnpm test`
Expected: PASS — 29 tests passed.

- [ ] **Step 14: Final production build check**

Run: `pnpm exec vite build`
Expected: build succeeds cleanly.

---

## Future Work

- [ ] Decide and configure a hosting provider (Vercel vs. Netlify vs. GitHub Pages) — no build changes needed either way (deferred in the design spec's "Open items for later").
- [ ] Consider a race picker UI for `eventScores` links that resolve to multiple races, instead of the v1 error message (deferred during planning — see Identifier design in the spec).
- [ ] Avoid the redundant re-fetch when selecting a racer from search: `search.js`'s `resolveAndLoadRace` already downloads `raceMeta`/`allResults`, but `onSelect(raceId, participantId)` only forwards the IDs, so `main.js`'s `showDashboard` re-fetches the entire race from scratch via `loadRaceById`. Fix by extending `onSelect` to pass the already-fetched data through and giving `showDashboard` a fast path that skips fetching when data is already available (deep links would still need to fetch). Flagged during Task 12 code review — deferred because it touches `search.js`'s already-approved interface, not because it's low-value.
- [ ] Handle partial URL params (`?race=` present without `?id=`, or vice versa): `main.js`'s `route()` currently treats this the same as no params at all (falls through to a bare search screen with no notice or prefill). Consider prefilling `raceInput` with whichever ID is present. Flagged during Task 12 code review as a minor UX gap, not a correctness bug.
