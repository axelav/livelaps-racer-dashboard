# Moto-Tally Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Moto-Tally as a second race data source so a pasted Moto-Tally results link produces the same racer-breakdown dashboard the app already builds from LiveLaps.

**Architecture:** Two self-contained source modules (`livelaps.js` untouched, new `mototally.js`) behind a trivial dispatcher (`raceSource.js`). Moto-Tally is fetched server-side via a new nginx reverse-proxy (it sends no CORS headers), parsed from HTML into the same normalized record shape LiveLaps produces, with full cumulative standings derived from the parsed field. The shared dashboard feature-detects the one field Moto-Tally lacks (average speed) on `null`, never on source identity.

**Tech Stack:** Vanilla JS, Vite, Vitest, `DOMParser` (browser) / `happy-dom` (tests only), nginx.

**Spec:** `docs/superpowers/specs/2026-07-14-mototally-integration-design.md`

---

## File Structure

- **Create `src/mototally.js`** — self-contained Moto-Tally source: URL parsing, HTML parsing, standings derivation, class→overall resolution, fetch orchestration. Exposes `isMotoTallyUrl`, `resolveAndLoadRace`, `loadRaceById` (same interface as `livelaps.js`), plus internal pure helpers exported for testing.
- **Create `src/time.js`** — shared time helpers `parseClock` (M:SS or H:MM:SS → seconds) and `formatHMS` (seconds → always-hours `H:MM:SS`, the format `livelaps.js`'s `parseDuration` requires).
- **Create `src/raceSource.js`** — the dispatcher; the only module that imports both sources. Re-exports `deriveTotals` and the error classes so consumers have one import surface.
- **Modify `src/main.js`** — switch `loadRaceById`/`deriveTotals`/`UnsupportedFormatError` imports to `raceSource.js`.
- **Modify `src/search.js`** — switch `resolveAndLoadRace`/error imports to `raceSource.js`; make copy source-agnostic.
- **Modify `src/dashboard.js`** — guard the three average-speed render sites on `racer.avgSpeedTotal != null`.
- **Modify `index.html`** (repo root) — source-agnostic `<title>`.
- **Modify `nginx.conf`** — add `/proxy/mototally/` reverse-proxy block.
- **Modify `package.json`** — add `happy-dom` devDependency (tests build a `Document` in Node).
- **Create tests** — `test/mototally-url.test.js`, `test/time.test.js`, `test/mototally-parse.test.js` (+ `test/fixtures/mototally.fixture.js`), `test/mototally-standings.test.js`, `test/raceSource.test.js`.

Test runner command used throughout: `pnpm exec vitest run <path>`.

---

### Task 1: nginx reverse-proxy for Moto-Tally

**Files:**
- Modify: `nginx.conf`

- [ ] **Step 1: Add the proxy location block**

Edit `nginx.conf` to this exact content (adds the `/proxy/mototally/` block; leaves the SPA fallback intact):

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location /proxy/mototally/ {
        proxy_pass https://www.moto-tally.com/;
        proxy_set_header Host www.moto-tally.com;
        proxy_ssl_server_name on;
        proxy_set_header Accept-Encoding "";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`proxy_ssl_server_name on` is required because moto-tally.com is behind SNI; `Accept-Encoding ""` asks the upstream for uncompressed HTML so the browser receives parseable text.

- [ ] **Step 2: Add a dev-server proxy so the app works under `vite dev` too**

The nginx block only exists in the built Docker image. For local `pnpm dev`, add the same proxy to Vite. Create/modify `vite.config.js` at the repo root:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/proxy/mototally': {
        target: 'https://www.moto-tally.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/proxy\/mototally/, '')
      }
    }
  }
});
```

- [ ] **Step 3: Manually verify the proxy forwards HTML**

Run: `pnpm dev` in one terminal, then in another:
`curl -s "http://localhost:5173/proxy/mototally/ECEA/Enduro/Results.aspx/2026/6/O1/CS" | grep -c "mtR_gvResults"`
Expected: prints `1` or more (the results table id is present in the proxied HTML). Stop the dev server after.

- [ ] **Step 4: Commit**

```bash
git add nginx.conf vite.config.js
git commit -m "feat: add moto-tally reverse proxy (nginx + vite dev)"
```

---

### Task 2: Moto-Tally URL parsing

**Files:**
- Create: `src/mototally.js`
- Test: `test/mototally-url.test.js`

The record/descriptor: `parseMotoTallyUrl` returns `{ org, discipline, year, round, group, view }`. `isMotoTallyUrl` is the dispatcher's cheap host check. Non-Enduro disciplines throw `UnsupportedFormatError` (reused from `livelaps.js`); unrecognized shapes throw `UnparseableInputError`.

- [ ] **Step 1: Write the failing test**

Create `test/mototally-url.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isMotoTallyUrl, parseMotoTallyUrl } from '../src/mototally.js';
import { UnsupportedFormatError, UnparseableInputError } from '../src/livelaps.js';

describe('isMotoTallyUrl', () => {
  it('recognizes moto-tally links, rejects others', () => {
    expect(isMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS')).toBe(true);
    expect(isMotoTallyUrl('https://www.livelaps.com/race/results/79103')).toBe(false);
    expect(isMotoTallyUrl('79103')).toBe(false);
  });
});

describe('parseMotoTallyUrl', () => {
  it('parses an overall-grouping URL', () => {
    expect(parseMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'))
      .toEqual({ org: 'ECEA', discipline: 'Enduro', year: '2026', round: '6', group: 'O1', view: 'CS' });
  });

  it('parses a single-class URL', () => {
    expect(parseMotoTallyUrl('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/C8/CS').group).toBe('C8');
  });

  it('rejects a non-Enduro discipline', () => {
    expect(() => parseMotoTallyUrl('https://www.moto-tally.com/ECEA/HareScramble/Results.aspx/2026/6/O1/CS'))
      .toThrow(UnsupportedFormatError);
  });

  it('rejects unparseable input', () => {
    expect(() => parseMotoTallyUrl('https://www.moto-tally.com/nonsense')).toThrow(UnparseableInputError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/mototally-url.test.js`
Expected: FAIL — cannot import from `../src/mototally.js` (module does not exist).

- [ ] **Step 3: Create `src/mototally.js` with URL parsing**

```js
import { UnsupportedFormatError, UnparseableInputError } from './livelaps.js';

const URL_PATTERN =
  /moto-tally\.com\/([^/]+)\/([^/]+)\/Results\.aspx\/(\d+)\/(\d+)\/([OC]\d+)\/([A-Za-z]+)/i;

export function isMotoTallyUrl(input) {
  return typeof input === 'string' && /moto-tally\.com/i.test(input);
}

export function parseMotoTallyUrl(input) {
  const match = typeof input === 'string' ? input.match(URL_PATTERN) : null;
  if (!match) {
    throw new UnparseableInputError(
      "Couldn't read that Moto-Tally link — copy the full results page URL and try again."
    );
  }
  const [, org, discipline, year, round, group, view] = match;
  if (discipline.toLowerCase() !== 'enduro') {
    throw new UnsupportedFormatError(
      "This race format isn't supported yet — Racer Breakdown currently works with section-based (enduro) races."
    );
  }
  return { org, discipline, year, round, group, view };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/mototally-url.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mototally.js test/mototally-url.test.js
git commit -m "feat: parse moto-tally result URLs"
```

---

### Task 3: Time helpers (`parseClock`, `formatHMS`)

**Files:**
- Create: `src/time.js`
- Test: `test/time.test.js`

Moto-Tally totals are `M:SS` (`27:35`); `livelaps.js`'s `parseDuration` requires a mandatory hours component (`H:MM:SS`), so every emitted time string must be `formatHMS`-formatted.

- [ ] **Step 1: Write the failing test**

Create `test/time.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseClock, formatHMS } from '../src/time.js';
import { parseDuration } from '../src/livelaps.js';

describe('parseClock', () => {
  it('parses M:SS', () => expect(parseClock('27:35')).toBe(27 * 60 + 35));
  it('parses H:MM:SS', () => expect(parseClock('1:05:20')).toBe(3920));
  it('returns null for blank/dnf', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock(' ')).toBeNull();
  });
});

describe('formatHMS', () => {
  it('always includes an hours component', () => {
    expect(formatHMS(1655)).toBe('0:27:35');
    expect(formatHMS(0)).toBe('0:00:00');
    expect(formatHMS(3920)).toBe('1:05:20');
  });
  it('round-trips through livelaps parseDuration', () => {
    expect(parseDuration(formatHMS(1655))).toBe(1655);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/time.test.js`
Expected: FAIL — `../src/time.js` does not exist.

- [ ] **Step 3: Create `src/time.js`**

```js
// Parse "M:SS" or "H:MM:SS" to seconds; blank/&nbsp;/garbage -> null.
export function parseClock(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/ /g, ' ').trim();
  const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, h, m, s] = match;
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);
}

// Seconds -> "H:MM:SS" (hours always present, so livelaps parseDuration accepts it).
export function formatHMS(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/time.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/time.js test/time.test.js
git commit -m "feat: add H:MM:SS time helpers for moto-tally"
```

---

### Task 4: HTML parsers (results table, race name, AMA set, overall options)

**Files:**
- Modify: `src/mototally.js`
- Modify: `package.json` (add `happy-dom`)
- Create: `test/fixtures/mototally.fixture.js`
- Test: `test/mototally-parse.test.js`

Production parsing uses the browser's `DOMParser`. The parse functions take a `Document` (injectable seam) so tests can build one with `happy-dom` without changing the Vitest environment. Four pure parsers:
- `parseResults(doc)` → array of raw records `{ id, fullName, displayedNumber, brand, className, overallPosition, totalTimeSeconds, sectionTimes: [{seconds, publishedPlace} | null] }`. Timed-section columns are those where the **first data row** (the winner, who completes every check) has a time; every racer is read against that same column set, so a DNF's missed section becomes `null` and rows stay index-aligned.
- `parseRaceName(doc)` → text of `#mtR_h1RREventName`.
- `parseAmaSet(doc)` → `Set` of AMA# strings (used for class→overall discovery).
- `parseOverallOptions(doc)` → array of overall group codes (`O1`…`O5`) read from `#mtR_ddlSelectClass`.

- [ ] **Step 1: Add happy-dom**

Run: `pnpm add -D happy-dom`
Expected: `happy-dom` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Create the fixture**

Create `test/fixtures/mototally.fixture.js`. This is a hand-computed 3-racer, 2-timed-check table (checks 1 and 2 are timed; a middle `0` column is an untimed checkpoint to prove it is skipped) plus the combined class/overall dropdown. Values are chosen so cumulative order changes between sections.

```js
// 3 riders, checks: [timed, untimed(0), timed]. Winner row first (defines timed columns).
// Section times (seconds):        RaceTotal
//   A (AMA 111, AA): 120, 180  -> 300 (5:00)  EventPlace 1
//   B (AMA 222, AA):  60, 300  -> 360 (6:00)  EventPlace 2
//   C (AMA 333, B ): 180, 240  -> 420 (7:00)  EventPlace 3
export const MOTOTALLY_FIXTURE_HTML = `
<h1 id="mtR_h1RREventName">2026 Test Enduro</h1>
<select id="mtR_ddlSelectClass">
  <option value="O1">OVERALL Long Course</option>
  <option value="O2">OVERALL A</option>
  <option value="C8">A Senior 40+</option>
</select>
<table id="mtR_gvResults" cellspacing="1" border="0">
  <tr><td colspan="12">OVERALL Long Course - Check-by-Check Score by Place</td></tr>
  <tr><td>EventPlace</td><td>AMA#</td><td>Row</td><td>Rider Name</td><td>Club</td><td>Sponsors</td><td>Brand</td><td>Class</td><td>1</td><td>2</td><td>3</td><td>MaxChk</td><td>TotalTime</td></tr>
  <tr class="gvAR"><td>1</td><td>111</td><td>22A</td><td><a href='javascript:getRiderDetail(1);'>RIDER A</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb Beta'>BET</span></td><td>AA</td><td>2:00<span style='font-size:6pt'> (2)</span></td><td>0</td><td>3:00<span style='font-size:6pt'> (1)</span></td><td>2</td><td>5:00</td></tr>
  <tr class="gvR"><td>2</td><td>222</td><td>18A</td><td><a href='javascript:getRiderDetail(2);'>RIDER B</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb KTM'>KTM</span></td><td>AA</td><td>1:00<span style='font-size:6pt'> (1)</span></td><td>0</td><td>5:00<span style='font-size:6pt'> (3)</span></td><td>2</td><td>6:00</td></tr>
  <tr class="gvAR"><td>3</td><td>333</td><td>4B</td><td><a href='javascript:getRiderDetail(3);'>RIDER C</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb Gas'>GAS</span></td><td>B</td><td>3:00<span style='font-size:6pt'> (3)</span></td><td>0</td><td>4:00<span style='font-size:6pt'> (2)</span></td><td>2</td><td>7:00</td></tr>
</table>`;

// Build a happy-dom Document from an HTML string (test helper).
export async function docFromHtml(html) {
  const { Window } = await import('happy-dom');
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}
```

- [ ] **Step 3: Write the failing test**

Create `test/mototally-parse.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { MOTOTALLY_FIXTURE_HTML, docFromHtml } from './fixtures/mototally.fixture.js';
import { parseResults, parseRaceName, parseAmaSet, parseOverallOptions } from '../src/mototally.js';

let doc;
beforeAll(async () => { doc = await docFromHtml(MOTOTALLY_FIXTURE_HTML); });

describe('parseRaceName', () => {
  it('reads the event h1', () => expect(parseRaceName(doc)).toBe('2026 Test Enduro'));
});

describe('parseOverallOptions', () => {
  it('returns only O-codes from the combined dropdown', () => {
    expect(parseOverallOptions(doc)).toEqual(['O1', 'O2']);
  });
});

describe('parseAmaSet', () => {
  it('collects every rider AMA number', () => {
    expect(parseAmaSet(doc)).toEqual(new Set(['111', '222', '333']));
  });
});

describe('parseResults', () => {
  it('parses one raw record per rider, skipping the untimed (0) check', () => {
    const rows = parseResults(doc);
    expect(rows).toHaveLength(3);
    const a = rows[0];
    expect(a).toMatchObject({
      id: 111, fullName: 'RIDER A', displayedNumber: '22A', brand: 'BET',
      className: 'AA', overallPosition: 1, totalTimeSeconds: 300
    });
    expect(a.sectionTimes).toEqual([
      { seconds: 120, publishedPlace: 2 },
      { seconds: 180, publishedPlace: 1 }
    ]);
    expect(rows[1].sectionTimes.map((s) => s.seconds)).toEqual([60, 300]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm exec vitest run test/mototally-parse.test.js`
Expected: FAIL — `parseResults`/`parseRaceName`/`parseAmaSet`/`parseOverallOptions` are not exported.

- [ ] **Step 5: Add the parsers to `src/mototally.js`**

Add these imports and functions to `src/mototally.js`:

```js
import { parseClock } from './time.js';

const FIXED_COLS = 8; // EventPlace, AMA#, Row, Name, Club, Sponsors, Brand, Class
const TRAILING_COLS = 2; // MaxChk, TotalTime

function dataRows(doc) {
  const table = doc.querySelector('#mtR_gvResults');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).filter((tr) => {
    const first = tr.querySelector('td');
    return first && /^\d+$/.test(first.textContent.trim());
  });
}

function cellsOf(tr) {
  return Array.from(tr.querySelectorAll('td'));
}

// A check cell is "M:SS (place)" when timed, or "0"/blank when an untimed checkpoint.
function parseCheckCell(td) {
  const text = td.textContent.replace(/ /g, ' ').trim();
  const m = text.match(/^(\d+:\d{2})\s*\((\d+)\)$/);
  if (!m) return null;
  return { seconds: parseClock(m[1]), publishedPlace: Number(m[2]) };
}

export function parseRaceName(doc) {
  return doc.querySelector('#mtR_h1RREventName')?.textContent.trim() ?? '';
}

export function parseOverallOptions(doc) {
  const select = doc.querySelector('#mtR_ddlSelectClass');
  if (!select) return [];
  return Array.from(select.querySelectorAll('option'))
    .map((o) => o.getAttribute('value'))
    .filter((v) => /^O\d+$/.test(v));
}

export function parseAmaSet(doc) {
  return new Set(dataRows(doc).map((tr) => cellsOf(tr)[1].textContent.trim()));
}

export function parseResults(doc) {
  const rows = dataRows(doc);
  if (rows.length === 0) return [];

  // Timed columns = check columns where the winner (first data row) has a time.
  const winnerCells = cellsOf(rows[0]);
  const checkStart = FIXED_COLS;
  const checkEnd = winnerCells.length - TRAILING_COLS; // exclusive
  const timedCols = [];
  for (let c = checkStart; c < checkEnd; c++) {
    if (parseCheckCell(winnerCells[c]) !== null) timedCols.push(c);
  }

  return rows.map((tr) => {
    const cells = cellsOf(tr);
    const sectionTimes = timedCols.map((c) => parseCheckCell(cells[c])); // null = DNF at that section
    return {
      id: Number(cells[1].textContent.trim()),
      fullName: cells[3].textContent.trim(),
      displayedNumber: cells[2].textContent.trim(),
      brand: cells[6].textContent.trim(),
      className: cells[7].textContent.trim(),
      overallPosition: Number(cells[0].textContent.trim()),
      totalTimeSeconds: parseClock(cells[cells.length - 1].textContent),
      sectionTimes
    };
  });
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm exec vitest run test/mototally-parse.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/mototally.js package.json pnpm-lock.yaml test/fixtures/mototally.fixture.js test/mototally-parse.test.js
git commit -m "feat: parse moto-tally results table, race name, ama set, overall options"
```

---

### Task 5: `pickContainingGroup` — class→overall selection

**Files:**
- Modify: `src/mototally.js`
- Test: `test/mototally-parse.test.js` (append)

Pure selection: given overall-page summaries `{ group, amaSet }` and the pasted class page's AMA set, pick the **largest** overall page whose AMA set contains every class rider. Verified live: the C8 class appears in O1 (260) and O2 (84); largest-containing → O1.

- [ ] **Step 1: Write the failing test (append to `test/mototally-parse.test.js`)**

```js
import { pickContainingGroup } from '../src/mototally.js';

describe('pickContainingGroup', () => {
  const classAmas = new Set(['111', '222']);
  it('picks the largest overall page that contains all class riders', () => {
    const summaries = [
      { group: 'O1', amaSet: new Set(['111', '222', '333', '444']) }, // biggest, contains
      { group: 'O2', amaSet: new Set(['111', '222', '333']) },        // contains, smaller
      { group: 'O5', amaSet: new Set(['555', '666']) }                // does not contain
    ];
    expect(pickContainingGroup(summaries, classAmas)?.group).toBe('O1');
  });
  it('returns null when no overall page contains the class', () => {
    expect(pickContainingGroup([{ group: 'O5', amaSet: new Set(['999']) }], classAmas)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/mototally-parse.test.js`
Expected: FAIL — `pickContainingGroup` is not exported.

- [ ] **Step 3: Add `pickContainingGroup` to `src/mototally.js`**

```js
export function pickContainingGroup(summaries, classAmaSet) {
  const containing = summaries.filter((s) =>
    [...classAmaSet].every((ama) => s.amaSet.has(ama))
  );
  if (containing.length === 0) return null;
  return containing.reduce((best, s) => (s.amaSet.size > best.amaSet.size ? s : best));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/mototally-parse.test.js`
Expected: PASS (all parse tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/mototally.js test/mototally-parse.test.js
git commit -m "feat: select containing overall group by ama-set superset"
```

---

### Task 6: `deriveStandings` — cumulative overall/class positions, gaps, DNF handling

**Files:**
- Modify: `src/mototally.js`
- Test: `test/mototally-standings.test.js`

Turns raw records (Task 4) into normalized records matching the shape `deriveSectionSeries` (in `livelaps.js`) reads. All cumulative standings are derived by ranking the parsed field on elapsed time. `avgSpeedTotal` and each `sections[].avgSpeed` are `null` (no speed data). Every time string is `formatHMS`-formatted. DNF: a racer with a missing timed section has `null` cumulative from that section on and drops out of ranking there.

- [ ] **Step 1: Write the failing test**

Create `test/mototally-standings.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { deriveStandings } from '../src/mototally.js';

// Same 3 riders as the parse fixture (hand-computed).
const RAW = [
  { id: 111, fullName: 'RIDER A', displayedNumber: '22A', brand: 'BET', className: 'AA', overallPosition: 1, totalTimeSeconds: 300, sectionTimes: [{ seconds: 120, publishedPlace: 2 }, { seconds: 180, publishedPlace: 1 }] },
  { id: 222, fullName: 'RIDER B', displayedNumber: '18A', brand: 'KTM', className: 'AA', overallPosition: 2, totalTimeSeconds: 360, sectionTimes: [{ seconds: 60, publishedPlace: 1 }, { seconds: 300, publishedPlace: 3 }] },
  { id: 333, fullName: 'RIDER C', displayedNumber: '4B', brand: 'GAS', className: 'B', overallPosition: 3, totalTimeSeconds: 420, sectionTimes: [{ seconds: 180, publishedPlace: 3 }, { seconds: 240, publishedPlace: 2 }] }
];

describe('deriveStandings', () => {
  const rows = deriveStandings(RAW);
  const a = rows[0], b = rows[1], c = rows[2];

  it('sets final class position from totals and nulls speed', () => {
    expect(a.classPosition).toBe(1); // A before B within AA
    expect(b.classPosition).toBe(2);
    expect(c.classPosition).toBe(1); // only rider in class B
    expect(a.avgSpeedTotal).toBeNull();
  });

  it('emits leader gaps as H:MM:SS', () => {
    expect(a.overallBehindByLeader).toBe('0:00:00');
    expect(b.overallBehindByLeader).toBe('0:01:00'); // 360-300
    expect(c.classBehindByLeader).toBe('0:00:00');   // class-B leader
  });

  it('derives cumulative overall position per section (order flips)', () => {
    // After section 1 cum: B=60, A=120, C=180  -> B1 A2 C3
    expect([a, b, c].map((r) => r.sections[0].overallPosition)).toEqual([2, 1, 3]);
    // After section 2 cum: A=300, B=360, C=420 -> A1 B2 C3 (== EventPlace)
    expect([a, b, c].map((r) => r.sections[1].overallPosition)).toEqual([1, 2, 3]);
  });

  it('derives cumulative class position and section-only class rank', () => {
    expect(a.sections[1].classPosition).toBe(1); // A leads AA after sec2
    expect(b.sections[0].classPosition).toBe(1); // B leads AA after sec1
    expect(a.sections[0].sectionClassPosition).toBe(2); // A slower than B in sec1
  });

  it('keeps published section-only overall rank and cumulative time', () => {
    expect(a.sections[0].sectionOverallPosition).toBe(2);
    expect(a.sections[1].totalCumulatedTime).toBe('0:05:00');
  });

  it('gap to rider ahead after section 1', () => {
    expect(a.sections[0].overallBehindBy).toBe('0:01:00'); // A(120) - B(60)
    expect(b.sections[0].overallBehindBy).toBe('0:00:00'); // B is leader after sec1
  });

  it('handles a DNF racer: null standings from the missed section on', () => {
    const dnf = deriveStandings([
      RAW[0],
      { id: 999, fullName: 'DNF', displayedNumber: '9Z', brand: 'HON', className: 'AA', overallPosition: 4, totalTimeSeconds: null, sectionTimes: [{ seconds: 90, publishedPlace: 1 }, null] }
    ]);
    const d = dnf.find((r) => r.id === 999);
    expect(d.sections[0].overallPosition).toBe(1);  // 90 < A's 120
    expect(d.sections[1].overallPosition).toBeNull(); // DNF, no cum time
    expect(d.sections[1].totalCumulatedTime).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/mototally-standings.test.js`
Expected: FAIL — `deriveStandings` is not exported.

- [ ] **Step 3: Add `deriveStandings` to `src/mototally.js`**

```js
import { formatHMS } from './time.js'; // add alongside the existing parseClock import

export function deriveStandings(rawRecords) {
  const n = rawRecords.length;
  const sectionCount = rawRecords[0]?.sectionTimes.length ?? 0;

  // cumulative seconds per racer per section; null from the first missing section on (DNF).
  const cum = rawRecords.map((r) => {
    const out = [];
    let acc = 0;
    let dead = false;
    for (let i = 0; i < sectionCount; i++) {
      const st = r.sectionTimes[i];
      if (dead || st == null || st.seconds == null) {
        dead = true;
        out.push(null);
      } else {
        acc += st.seconds;
        out.push(acc);
      }
    }
    return out;
  });

  const cumulativePosition = (si, ri, sameClass) => {
    const me = cum[ri][si];
    if (me == null) return null;
    let pos = 1;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      if (sameClass && rawRecords[j].className !== rawRecords[ri].className) continue;
      const v = cum[j][si];
      if (v != null && v < me) pos++;
    }
    return pos;
  };

  const gapAhead = (si, ri) => {
    const me = cum[ri][si];
    if (me == null) return null;
    let bestAhead = null;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      const v = cum[j][si];
      if (v != null && v < me && (bestAhead == null || v > bestAhead)) bestAhead = v;
    }
    return bestAhead == null ? 0 : me - bestAhead;
  };

  const sectionClassRank = (si, ri) => {
    const st = rawRecords[ri].sectionTimes[si];
    if (st == null || st.seconds == null) return null;
    let pos = 1;
    for (let j = 0; j < n; j++) {
      if (j === ri) continue;
      if (rawRecords[j].className !== rawRecords[ri].className) continue;
      const o = rawRecords[j].sectionTimes[si];
      if (o != null && o.seconds != null && o.seconds < st.seconds) pos++;
    }
    return pos;
  };

  const totals = rawRecords.map((r) => r.totalTimeSeconds).filter((v) => v != null);
  const overallLeaderTotal = totals.length ? Math.min(...totals) : 0;

  return rawRecords.map((r, ri) => {
    const classMates = rawRecords.filter((x) => x.className === r.className && x.totalTimeSeconds != null);
    const classLeaderTotal = classMates.length ? Math.min(...classMates.map((x) => x.totalTimeSeconds)) : 0;
    const classPosition = 1 + classMates.filter((x) => x.totalTimeSeconds < r.totalTimeSeconds).length;

    const sections = r.sectionTimes.map((st, si) => {
      const gap = gapAhead(si, ri);
      return {
        sectionName: `Test ${si + 1}`,
        totalCumulatedTime: cum[ri][si] == null ? null : formatHMS(cum[ri][si]),
        overallPosition: cumulativePosition(si, ri, false),
        classPosition: cumulativePosition(si, ri, true),
        sectionOverallPosition: st?.publishedPlace ?? null,
        sectionClassPosition: sectionClassRank(si, ri),
        avgSpeed: null,
        overallBehindBy: gap == null ? null : formatHMS(gap)
      };
    });

    return {
      id: r.id,
      fullName: r.fullName,
      displayedNumber: r.displayedNumber,
      brand: r.brand,
      className: r.className,
      overallPosition: r.overallPosition,
      classPosition,
      avgSpeedTotal: null,
      overallBehindByLeader: r.totalTimeSeconds == null ? null : formatHMS(r.totalTimeSeconds - overallLeaderTotal),
      classBehindByLeader: r.totalTimeSeconds == null ? null : formatHMS(r.totalTimeSeconds - classLeaderTotal),
      sections
    };
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/mototally-standings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mototally.js test/mototally-standings.test.js
git commit -m "feat: derive moto-tally cumulative standings with dnf handling"
```

---

### Task 7: Fetch orchestration (`resolveAndLoadRace`, `loadRaceById`)

**Files:**
- Modify: `src/mototally.js`
- Test: `test/mototally-load.test.js`

Wires the pure pieces to the network through the proxy. `resolveAndLoadRace` parses the URL, resolves a class page up to its overall group, fetches and normalizes. `loadRaceById` re-loads from the app's own `mototally:...` descriptor.

- [ ] **Step 1: Write the failing test (fetch mocked)**

Create `test/mototally-load.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MOTOTALLY_FIXTURE_HTML } from './fixtures/mototally.fixture.js';
import { resolveAndLoadRace, loadRaceById, PROXY_PREFIX } from '../src/mototally.js';

// happy-dom provides DOMParser globally when we assign it; the module uses global DOMParser.
import { Window } from 'happy-dom';
globalThis.DOMParser = new Window().DOMParser;

function mockFetchReturning(html) {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => html }));
}

afterEach(() => vi.restoreAllMocks());

describe('resolveAndLoadRace (overall link)', () => {
  it('fetches the pasted O-page and normalizes it', async () => {
    globalThis.fetch = mockFetchReturning(MOTOTALLY_FIXTURE_HTML);
    const { raceId, raceMeta, allResults } = await resolveAndLoadRace(
      'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'
    );
    expect(raceId).toBe('mototally:ECEA/Enduro/2026/6/O1');
    expect(raceMeta).toEqual({ raceName: '2026 Test Enduro', modeName: 'Enduro' });
    expect(allResults).toHaveLength(3);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PROXY_PREFIX}ECEA/Enduro/Results.aspx/2026/6/O1/CS`);
  });
});

describe('loadRaceById', () => {
  it('re-loads from a mototally descriptor', async () => {
    globalThis.fetch = mockFetchReturning(MOTOTALLY_FIXTURE_HTML);
    const { allResults } = await loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(allResults[0].id).toBe(111);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/mototally-load.test.js`
Expected: FAIL — `resolveAndLoadRace`/`loadRaceById`/`PROXY_PREFIX` not exported.

- [ ] **Step 3: Add orchestration to `src/mototally.js`**

```js
export const PROXY_PREFIX = '/proxy/mototally/';

function buildPath({ org, discipline, year, round, group }, view = 'CS') {
  return `${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`;
}

async function fetchDoc(path) {
  const response = await fetch(PROXY_PREFIX + path);
  if (!response.ok) throw new Error(`Moto-Tally proxy request failed: ${response.status} ${path}`);
  const html = await response.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

function descriptorToRaceId({ org, discipline, year, round, group }) {
  return `mototally:${org}/${discipline}/${year}/${round}/${group}`;
}

function raceIdToDescriptor(raceId) {
  const [, path] = raceId.split('mototally:');
  const [org, discipline, year, round, group] = path.split('/');
  return { org, discipline, year, round, group };
}

async function resolveClassToOverall(descriptor) {
  const classDoc = await fetchDoc(buildPath(descriptor));
  const classAmas = parseAmaSet(classDoc);
  const overallGroups = parseOverallOptions(classDoc);
  const summaries = await Promise.all(
    overallGroups.map(async (group) => ({
      group,
      amaSet: parseAmaSet(await fetchDoc(buildPath({ ...descriptor, group })))
    }))
  );
  const picked = pickContainingGroup(summaries, classAmas);
  return picked ? { ...descriptor, group: picked.group } : descriptor;
}

async function loadOverall(descriptor) {
  const doc = await fetchDoc(buildPath(descriptor));
  return {
    raceId: descriptorToRaceId(descriptor),
    raceMeta: { raceName: parseRaceName(doc), modeName: 'Enduro' },
    allResults: deriveStandings(parseResults(doc))
  };
}

export async function resolveAndLoadRace(input) {
  const descriptor = parseMotoTallyUrl(input);
  const overall = descriptor.group.startsWith('O') ? descriptor : await resolveClassToOverall(descriptor);
  return loadOverall(overall);
}

export async function loadRaceById(raceId) {
  return loadOverall(raceIdToDescriptor(raceId));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/mototally-load.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mototally.js test/mototally-load.test.js
git commit -m "feat: moto-tally fetch orchestration and class->overall resolution"
```

---

### Task 8: `raceSource.js` dispatcher

**Files:**
- Create: `src/raceSource.js`
- Test: `test/raceSource.test.js`

The only module that imports both sources. Routes by input shape; re-exports `deriveTotals` and error classes so `main.js`/`search.js` have one import surface.

- [ ] **Step 1: Write the failing test**

Create `test/raceSource.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as raceSource from '../src/raceSource.js';
import * as livelaps from '../src/livelaps.js';
import * as mototally from '../src/mototally.js';

afterEach(() => vi.restoreAllMocks());

describe('raceSource dispatch', () => {
  it('routes moto-tally URLs to mototally', async () => {
    const spy = vi.spyOn(mototally, 'resolveAndLoadRace').mockResolvedValue({ raceId: 'mototally:x' });
    await raceSource.resolveAndLoadRace('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS');
    expect(spy).toHaveBeenCalled();
  });

  it('routes bare IDs / livelaps URLs to livelaps', async () => {
    const spy = vi.spyOn(livelaps, 'resolveAndLoadRace').mockResolvedValue({ raceId: 79103 });
    await raceSource.resolveAndLoadRace('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('routes mototally descriptors to mototally.loadRaceById', async () => {
    const spy = vi.spyOn(mototally, 'loadRaceById').mockResolvedValue({});
    await raceSource.loadRaceById('mototally:ECEA/Enduro/2026/6/O1');
    expect(spy).toHaveBeenCalled();
  });

  it('routes numeric race ids to livelaps.loadRaceById', async () => {
    const spy = vi.spyOn(livelaps, 'loadRaceById').mockResolvedValue({});
    await raceSource.loadRaceById('79103');
    expect(spy).toHaveBeenCalled();
  });

  it('re-exports deriveTotals', () => {
    expect(raceSource.deriveTotals).toBe(livelaps.deriveTotals);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run test/raceSource.test.js`
Expected: FAIL — `../src/raceSource.js` does not exist.

- [ ] **Step 3: Create `src/raceSource.js`**

```js
import * as livelaps from './livelaps.js';
import * as mototally from './mototally.js';

export {
  deriveTotals,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './livelaps.js';

export function resolveAndLoadRace(input) {
  if (mototally.isMotoTallyUrl(input)) return mototally.resolveAndLoadRace(input);
  return livelaps.resolveAndLoadRace(input);
}

export function loadRaceById(raceId) {
  if (typeof raceId === 'string' && raceId.startsWith('mototally:')) {
    return mototally.loadRaceById(raceId);
  }
  return livelaps.loadRaceById(raceId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run test/raceSource.test.js`
Expected: PASS (5 tests).

Note: this test spies on ES module namespace members. If `vi.spyOn` on the namespace fails under the project's Vitest config, change each source module's internal call sites to go through the namespace, or assert dispatch via `globalThis.fetch` mocks instead. Prefer the spy approach first.

- [ ] **Step 5: Commit**

```bash
git add src/raceSource.js test/raceSource.test.js
git commit -m "feat: add race-source dispatcher over livelaps and moto-tally"
```

---

### Task 9: Wire the dispatcher into `main.js` and `search.js`

**Files:**
- Modify: `src/main.js:2`
- Modify: `src/search.js:1-6`, `src/search.js:14`, `src/search.js:23`

- [ ] **Step 1: Repoint `main.js` imports**

In `src/main.js`, change line 2 from:

```js
import { loadRaceById, deriveTotals, UnsupportedFormatError } from './livelaps.js';
```

to:

```js
import { loadRaceById, deriveTotals, UnsupportedFormatError } from './raceSource.js';
```

- [ ] **Step 2: Repoint `search.js` imports and update copy**

In `src/search.js`, change the import block (lines 1-6) from `'./livelaps.js'` to `'./raceSource.js'`:

```js
import {
  resolveAndLoadRace,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './raceSource.js';
```

Change the subhead (line 14) to:

```html
        <p class="subhead">Paste a LiveLaps or Moto-Tally results link, or a bare LiveLaps race ID.</p>
```

Change the input placeholder (line 23) to:

```html
        <input type="text" data-slot="raceInput" placeholder="LiveLaps or Moto-Tally link, or 79103" autocomplete="off" />
```

- [ ] **Step 3: Verify the full suite still passes**

Run: `pnpm exec vitest run`
Expected: PASS — all existing LiveLaps tests plus the new Moto-Tally tests.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/search.js
git commit -m "feat: route search and routing through the race-source dispatcher"
```

---

### Task 10: Feature-detect average speed in `dashboard.js`

**Files:**
- Modify: `src/dashboard.js:153-159` (speed tile), `:197-204` (speed chart), `:225` (table cell)

Average speed is the only field Moto-Tally lacks. Guard its three render sites on `racer.avgSpeedTotal != null` so Moto-Tally records don't crash (`null.toFixed`) or print `NaN`.

- [ ] **Step 1: Guard the average-speed stat tile**

Replace the speed-tile block (currently `src/dashboard.js:153-159`):

```js
  const statSpeed = slot('statSpeed');
  statSpeed.innerHTML = '';
  statSpeed.append(`${racer.avgSpeedTotal.toFixed(1)} `);
  const speedSmall = document.createElement('small');
  speedSmall.textContent = 'mph';
  statSpeed.appendChild(speedSmall);
  slot('statSpeedSub').textContent = `across all ${sectionCount} sections`;
```

with:

```js
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
```

- [ ] **Step 2: Guard the "Pace by section" speed chart**

Replace the speed `barChart` block (currently `src/dashboard.js:197-204`):

```js
  barChart(slot('chartSpeed'), {
    ariaLabel: 'Average speed by section',
    labels: series.names,
    values: series.avgSpeeds,
    color: colorSpeed,
    label: 'Avg speed',
    format: (v) => v.toFixed(1)
  });
```

with:

```js
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
```

- [ ] **Step 3: Guard the table average-speed cell**

Replace the speed cell in the table-row array (currently `src/dashboard.js:225`):

```js
      series.avgSpeeds[i].toFixed(3),
```

with:

```js
      Number.isFinite(series.avgSpeeds[i]) ? series.avgSpeeds[i].toFixed(3) : '—',
```

- [ ] **Step 4: Verify no regression on LiveLaps rendering path**

Run: `pnpm exec vitest run`
Expected: PASS. (Dashboard rendering itself is verified manually in Task 11; unit tests must stay green.)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: feature-detect average speed for speedless sources"
```

---

### Task 11: Title + full manual end-to-end verification

**Files:**
- Modify: `index.html` (repo root — the file containing `<title>Racer Breakdown — LiveLaps</title>`)

- [ ] **Step 1: Make the title source-agnostic**

Change `<title>Racer Breakdown — LiveLaps</title>` to:

```html
    <title>Racer Breakdown</title>
```

- [ ] **Step 2: Manually verify a Moto-Tally overall link end-to-end**

Run `pnpm dev`. In the browser:
1. Paste `https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS`, look up the race.
   Expected: race name "2026 Shotgun Enduro" appears; type-ahead lists riders.
2. Search "MCDONAL", select KYLE MCDONAL.
   Expected: dashboard renders with overall + class position tiles, gap-to-leader tile, **no average-speed tile** (3 tiles), overall/class through-race charts, cumulative-vs-section chart, gap-to-rider-ahead chart, **no "Pace by section" card**, and the section table (avg-speed column shows `—`).
3. Confirm the deep link is `?race=mototally:ECEA/Enduro/2026/6/O1&id=<AMA#>` and that reloading the page re-renders the same dashboard.

- [ ] **Step 3: Manually verify a Moto-Tally class link normalizes up to overall**

Paste `https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/C8/CS`, look up the race.
Expected: after a brief multi-fetch, the type-ahead lists the **whole Long-Course field** (not just class C8), and selecting a C8 rider shows an overall position > their class position. The deep link normalizes to `?race=mototally:ECEA/Enduro/2026/6/O1&...`.

- [ ] **Step 4: Manually verify LiveLaps still works (no regression)**

Paste a known LiveLaps race URL or bare ID (e.g. `79103`), look up, select a racer.
Expected: full dashboard **including** the average-speed tile and "Pace by section" chart — unchanged from before.

- [ ] **Step 5: Verify the production Docker/nginx path**

Run: `docker build -t racer-dash . && docker run --rm -p 8080:80 racer-dash` then
`curl -s "http://localhost:8080/proxy/mototally/ECEA/Enduro/Results.aspx/2026/6/O1/CS" | grep -c mtR_gvResults`
Expected: prints `1`+ (nginx proxy forwards Moto-Tally HTML in the built image). Stop the container after.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "chore: make app title source-agnostic"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** proxy (T1), URL parse + Enduro gate (T2), time-format contract (T3), HTML parse incl. untimed-check skipping and DOM-injection test seam (T4), class→overall AMA-set discovery (T5), full derived standings + DNF (T6), fetch orchestration + deep-link descriptor (T7), dispatcher + re-exports (T8), consumer wiring + copy (T9), speed feature-detection incl. crash guard (T10), manual e2e + Docker path (T11).
- **Type consistency:** raw record shape (T4) → consumed by `deriveStandings` (T6); normalized record fields match what `deriveSectionSeries`/`dashboard.js` read; `raceId` string `mototally:{org}/{discipline}/{year}/{round}/{group}` produced in T7 and split back the same way; `PROXY_PREFIX` used in T7 and asserted in its test.
- **Known follow-ups (see spec Future Work):** multi-fetch cost when resolving a class link (~6 requests); proxy is tied to self-hosted nginx/Vite-dev.

## Future Work (deferred during implementation)

Recorded from the per-task and final reviews. None block the feature; finishing racers on real Moto-Tally data render fully and correctly.

- [ ] **DNF racer rough edges (Moto-Tally).** A rider who did not finish every timed check (null `totalTimeSeconds`) currently gets racer-level `classPosition = 1` (`x.totalTimeSeconds < null` coerces to false, so the count is 0), duplicating a finishing classmate's rank, and the dashboard subhead reads "finished in null across N timed sections" (`series.cumTimes[last]` is null). Per-section standings already null out correctly from the missed check onward. Decide the desired DNF presentation (e.g. rank DNFs last / show "DNF") and handle racer-level `classPosition` + subhead for null totals. Note: many DNFs are filtered out earlier because their EventPlace cell isn't all-digits, so this only affects DNFs that still carry a numeric EventPlace but a blank total.
- [ ] **Empty-results soft failure.** A Moto-Tally URL whose discipline segment is `Enduro` but which isn't a parseable check-by-check results page yields an empty `allResults` (empty participant list) rather than a typed error. Consider surfacing a friendlier "no results found for that link" message.
- [ ] **URL-encode the deep-link raceId.** `main.js` builds `?race=${raceId}&id=${participantId}` with raw interpolation. Correct for all realistic Moto-Tally descriptors (path-segment org/discipline, numeric year/round, `O`/`C`+digits group), but would break if a segment ever contained `&`, `#`, `+`, or a space. Switch to `encodeURIComponent` for robustness.
- [ ] **Multi-fetch cost on class links.** Resolving a pasted class link fetches the class page plus each overall (`O`) page (~6 requests for ECEA) to find the containing grouping. Acceptable for a low-traffic tool; revisit with a cache or an early-stop heuristic if it becomes a problem.
- [ ] **Proxy portability.** The Moto-Tally reverse proxy lives in `nginx.conf` (prod) and `vite.config.js` (dev); it only works on the self-hosted Docker/nginx deployment. A move to a static host without a configurable proxy layer would need the fetch moved to a serverless function (the alternative considered in the spec).
