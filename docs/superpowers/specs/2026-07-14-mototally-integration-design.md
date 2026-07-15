# Moto-Tally Integration — Design

## Purpose

Add [Moto-Tally](https://www.moto-tally.com/) as a second race data source
alongside LiveLaps, so a user can paste a Moto-Tally results link and get the
same racer breakdown dashboard this app already builds from LiveLaps races.

## Non-goals (v1)

- Any race format other than Enduro — Moto-Tally URLs encode a discipline
  segment (e.g. `Enduro`); anything else is rejected the same way non-Enduro
  LiveLaps races are today.
- Simulating the site's dropdown postbacks (class/view selectors) — every
  combination is directly GET-navigable via the URL path, confirmed live for
  overall groupings (`O1`–`O5`) and single-class groupings (`C8`), so no
  session/ViewState handling is needed.
- Reproducing LiveLaps-only metrics Moto-Tally has no equivalent for (average
  speed, per-section class rank) — see Data normalization.

## Architecture: two self-contained sources, one feature-detecting UI

The two data sources are **two distinct, self-contained implementations** that
never branch on each other. They meet only at two thin seams:

```
src/
  livelaps.js    UNCHANGED — existing LiveLaps implementation
  mototally.js   NEW — self-contained Moto-Tally implementation
  raceSource.js  NEW — trivial dispatcher (the ONLY place that knows both exist)
  search.js      import switches from livelaps.js → raceSource.js; no other change
  main.js        import switches from livelaps.js → raceSource.js; no other change
  dashboard.js   feature-detects optional fields (see below); no source conditionals
  charts.js      UNCHANGED — shared by both
```

**Seam 1 — the dispatcher (`raceSource.js`):** the entire cross-source surface.

```js
export function resolveAndLoadRace(input) {
  if (isMotoTallyUrl(input)) return mototally.resolveAndLoadRace(input);
  return livelaps.resolveAndLoadRace(input); // bare IDs + LiveLaps URLs, unchanged
}
```

Both modules expose the same interface — `resolveAndLoadRace(input)` returning
`{ raceId, raceMeta, allResults }` — and the same normalized record shape (next
section). Nothing else in the app knows there is more than one source.

**Seam 2 — feature detection in `dashboard.js`:** where Moto-Tally lacks a
field it is set to `null` (not omitted from the object), and the dashboard skips
that tile/chart on **field-is-null**, never on which-source. There are exactly
two such optional features, so this is two presence checks, not a branch tree:

```js
if (racer.avgSpeedTotal != null) renderSpeedTile(racer);       // else skip tile
if (series.classPositions != null) renderClassPositionChart(series);
```

The dashboard never receives or inspects a source identifier.

## Why this needs a backend component (new for this project)

LiveLaps' API sends `Access-Control-Allow-Origin` for any origin, which is why
this app has stayed a pure static site. Moto-Tally is a server-rendered ASP.NET
page (confirmed via `curl`) with **no CORS headers at all** — a browser
`fetch()` from this app's domain is blocked. Something must fetch it server-side.

Chosen approach: add a `location /proxy/mototally/` block to the existing
`nginx.conf` that `proxy_pass`es to `https://www.moto-tally.com/`. The browser
requests same-origin (`/proxy/mototally/ECEA/Enduro/Results.aspx/...`); nginx
forwards it. Chosen over a serverless function because it reuses the Docker+nginx
deployment this app already has instead of introducing a new deploy target,
credentials, and failure surface. Trade-off: it only works because the app is
self-hosted via Docker+nginx today (see Future Work).

nginx only proxies the raw HTML — it does not rewrite the page's relative asset
links, because the client never renders the fetched page. `mototally.js` parses
the results table out of it via the DOM (see Testing for the parser seam) and
discards the rest.

## URL format and race identity

```
https://www.moto-tally.com/{org}/{discipline}/Results.aspx/{year}/{round}/{group}/{view}
```

- `{group}` is either an overall grouping (`O1`–`O5`) or a single class
  (`C1`–`C50`).
- `{view}` selects the layout (`CS` = Check-by-Check Score, `RTS`, `S`, …).
  Whatever view was pasted is discarded; the app always fetches `CS`, the only
  view with parseable per-check times.

`parseMotoTallyUrl(input)` extracts `{org, discipline, year, round, group}` and
validates `discipline === 'Enduro'`. The **normalized** descriptor (after any
class→overall resolution below) becomes this app's own deep-link `raceId`, e.g.
`?race=mototally:ECEA/Enduro/2026/6/O1&id=537856` (URL-encoded). Deep links
therefore always encode an overall (`O`) grouping, so re-loading is
deterministic and skips re-discovery.

## Position scope and class→overall normalization

**The problem:** Moto-Tally has no single "whole event field" URL. `EventPlace`
is renumbered *per page*. Confirmed live: rider DOUG ALLEN II (AMA 537856,
36:14) is `EventPlace 7` on the O1 Long-Course page but `EventPlace 1` on his
class page (C8, "A Senior 40+"). So `EventPlace` means "rank within this page's
grouping," and there is no URL that returns every rider in the event.

To give the dashboard a meaningful **overall position distinct from class
position**, the app always loads an **overall (`O`) grouping page** as
`allResults`, and derives class position from it:

- **Pasted URL is already an `O`-page:** load it directly. `allResults` = that
  grouping's full cross-class field.
- **Pasted URL is a `C`-page (single class):** resolve it up to the overall
  grouping that contains it, then load that:
  1. Fetch the pasted class page once — this yields the class name (from the
     class dropdown's selected `<option>`, e.g. `C8` → "A Senior 40+") and the
     list of `O`-group options (every page carries the overall dropdown).
  2. Fetch the `O`-group pages (in parallel through the proxy) and pick the
     **largest one whose field contains that class name.** Confirmed live this
     selects the course grouping over a division subset without hardcoding O-
     numbers: the C8 class appears in O1 (Long Course, 260 rows) and O2
     (Overall A, 84 rows); largest-containing → O1, the correct course-wide
     overall. It generalizes to other orgs because it keys on field size, not
     on a fixed O-number.
  3. Fallback: if no `O`-page contains the class (shouldn't occur), load the
     class page itself — overall and class then coincide (documented, not a
     crash).

On the resolved `O`-page: `overallPosition` = `EventPlace`; `classPosition` =
the racer's rank among same-`className` entries, ranked by `TotalTime`. "Overall"
here means "within this course grouping" — Moto-Tally's own notion of overall,
which is course-scoped (Long vs Short are separate). This is faithful to the
source; the dashboard does not claim a whole-event rank the site never computes.

## Data normalization

`mototally.js` parses the `mtR_gvResults` table (columns: `EventPlace`, `AMA#`,
`Row`, `Rider Name`, `Club`, `Sponsors`, `Brand`, `Class`, per-check columns,
`MaxChk`, `TotalTime`) into the same record shape `livelaps.js` produces. Where
a field has no Moto-Tally equivalent it is set to **`null`** (present on the
object, feature-detected by the dashboard — never omitted).

`raceMeta` = `{ raceName, modeName: 'Enduro' }`, with `raceName` from
`<h1 id="mtR_h1RREventName">` (e.g. "2026 Shotgun Enduro").

| Normalized field | Moto-Tally source |
|---|---|
| `id` | `AMA#` — stable per rider across events; the participant id used in the type-ahead and the `?id=` deep link. Assumed unique within a page (verified across the O1 field). |
| `fullName` | `Rider Name` (from the `<a>` cell text) |
| `displayedNumber` | `Row` (e.g. `22A`) |
| `className` | `Class` |
| `overallPosition` | `EventPlace` on the resolved `O`-page |
| `classPosition` | **derived**: rank among same-`className` entries by `TotalTime` |
| `overallBehindByLeader` / `classBehindByLeader` | **derived**: this racer's `TotalTime` minus the overall/class leader's, emitted as an `H:MM:SS` string (see Time-format contract) |
| `avgSpeedTotal` | **`null`** — Moto-Tally is penalty/time-card scoring; no speed exists |
| `sections[]` | one entry per check column with a nonzero value (checks reading `0` are untimed regular checkpoints; verified that summing the nonzero checks equals `TotalTime` exactly). `totalCumulatedTime` = running sum as `H:MM:SS`; `sectionOverallPosition` from the check's `(place)` annotation |
| `sections[].overallBehindBy` | **derived**: gap to the immediately-ahead racer's cumulative time at that section (arithmetic over already-parsed per-check cumulatives), as `H:MM:SS` |
| `sections[].avgSpeed`, `sections[].classPosition`, `sections[].sectionClassPosition` | **`null`** — no per-check speed or class standings are published; inferring them would assume a methodology Moto-Tally doesn't confirm |

The rule for derived-vs-null: race-final totals (`TotalTime`, `EventPlace`) are
authoritative published numbers, so ranking/differencing them is safe;
per-check standings beyond the published overall `(place)` are not published, so
nothing is invented.

### Time-format contract (correctness detail)

`dashboard.js` re-parses time strings with `livelaps.js`'s `parseDuration`,
whose regex **requires a mandatory hours component** (`^(\d+):(\d{2}):(\d{2}…)$`).
Moto-Tally totals are `M:SS` (`36:14`), which `parseDuration` would read as **0**.
Therefore every time string `mototally.js` emits — `totalCumulatedTime`, the
derived `*BehindBy*` gaps — **must be formatted `H:MM:SS`** (e.g. `0:36:14`),
even for sub-hour values, so the shared dashboard parses them correctly. This is
part of the record-shape contract, not just field names.

## Feature detection in the dashboard (correctness detail)

The dashboard currently calls `racer.avgSpeedTotal.toFixed(1)` and
`deriveSectionSeries` calls `parseFloat(s.avgSpeed)` **unconditionally** — with a
`null` value these throw / produce `NaN`. So "hide when absent" must be an
explicit **guard before the call**, not merely conditional display:

- Average-speed stat tile: render only when `racer.avgSpeedTotal != null`.
- Average-speed-per-section bar chart: render only when the section speeds are
  present.
- Class-position-per-section line chart: render only when per-section class
  positions are present.

`deriveSectionSeries` (in `livelaps.js`) is extended to tolerate `null` section
fields by producing `null` series arrays the dashboard can test, rather than
`NaN`-filled arrays. Everything else (overall-position chart, cumulative time,
gap-to-leader, table view) is unchanged and shared.

## UI changes

- `search.js`: subhead/placeholder text becomes source-agnostic ("Paste a
  LiveLaps or Moto-Tally results link…").
- `dashboard.js`: the three feature-detected renders above. No source
  conditionals.

## Error handling

Reuses the existing typed errors in `search.js`:

- Unparseable/unrecognized input: dispatcher falls through to LiveLaps, whose
  `UnparseableInputError` copy already covers it.
- Non-Enduro `discipline` segment: `UnsupportedFormatError` with existing copy.
- Proxy/fetch failure (nginx 502, site down, unexpected table markup, or the
  class→overall resolution finding no page): generic "Couldn't load that race —
  check the link and try again." — the fallback `search.js` already has for any
  non-typed error.

## Testing

Vitest, pure-logic focused, mirroring `test/livelaps.test.js`:

- `parseMotoTallyUrl()` against a table: overall-grouping URL, class-grouping
  URL, non-Enduro discipline, garbage, empty.
- **Parser seam for the DOM:** `vitest.config.js` sets no `environment`, so tests
  run in Node where `DOMParser` does not exist. The table parser therefore takes
  a parsed `Document` (or a small inject-a-parser seam) rather than calling
  `new DOMParser()` internally, so a fixture test can feed it a document built
  from a saved HTML snippet. (Alternative if this proves awkward: add
  `happy-dom`/`jsdom` and set `test.environment`; the injectable-parser seam is
  preferred to keep the test env unchanged.)
- Fixture test (saved `mtR_gvResults` snippet, alongside
  `test/fixtures/results.fixture.js`): asserts `sections` contains only the
  nonzero checks, `totalCumulatedTime` sums correctly and is `H:MM:SS`-formatted,
  and `classPosition` derivation is correct.
- Class→overall resolution: unit-test the "largest field containing the class"
  selection over canned page summaries (no network).
- `raceSource.js` dispatch: LiveLaps input routes to `livelaps.js`, Moto-Tally
  input routes to `mototally.js`.
- The nginx proxy and the dashboard's present/absent-field rendering are
  verified manually against the dev server, as with the existing search/dashboard
  toggle testing.

## Future Work

- [ ] If this app moves off self-hosted Docker+nginx, the proxy must move to
      whatever the new host supports (a serverless function was the considered
      alternative — see "Why this needs a backend component").
- [ ] Multi-fetch cost: resolving a pasted class link fetches the class page
      plus the `O`-group pages (≈6 requests for ECEA) to find the containing
      grouping. Acceptable for a low-traffic tool; revisit with a cache or an
      early-stop heuristic if it becomes a problem.
