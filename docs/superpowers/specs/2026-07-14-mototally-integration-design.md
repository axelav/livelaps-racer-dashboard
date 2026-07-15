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
  both an overall grouping (`O1`) and a single-class grouping (`C8`), so no
  session/ViewState handling is needed.
- Reproducing LiveLaps-only metrics that Moto-Tally has no equivalent for
  (average speed, per-section class rank) — see Data normalization.

## Why this needs a backend component (new for this project)

LiveLaps' API sends `Access-Control-Allow-Origin` for any origin, which is why
this app has stayed a pure static site. Moto-Tally is a server-rendered ASP.NET
page (confirmed via `curl`) with **no CORS headers at all** — a browser
`fetch()` from this app's domain would be blocked. Something has to request
the page server-side.

Chosen approach: add a `location /proxy/mototally/` block to the existing
`nginx.conf` that `proxy_pass`es to `https://www.moto-tally.com/`. The browser
requests same-origin (`/proxy/mototally/ECEA/Enduro/Results.aspx/...`); nginx
forwards it behind the scenes. This was chosen over a serverless function
(Cloudflare Worker, Netlify function, etc.) because it reuses the Docker+nginx
deployment this app already has (`Dockerfile`, `nginx.conf`) instead of
introducing a new deploy target, credentials, and failure surface. The
trade-off is that this only works because the app is self-hosted via
Docker+nginx today; a move to a host without a configurable proxy layer (e.g.
GitHub Pages) would need to revisit this.

nginx only proxies the raw HTML — it does not need to rewrite the page's own
relative asset links, because the client never renders the fetched page. It
parses the results table out of it via `DOMParser` and discards the rest.

## URL format and race identity

```
https://www.moto-tally.com/{org}/{discipline}/Results.aspx/{year}/{round}/{group}/{view}
```

Confirmed live: `{group}` is either an overall grouping (`O1`–`O5`, e.g. "OVERALL
Long Course") or a single class (`C1`–`C50`, e.g. "A SR 40+" as `C8`) — both are
fetched identically, just with a different (possibly single-class) field.
`{view}` selects the results layout (`CS` = Check-by-Check Score, `RTS` =
Running Total Score, `S` = Summary, etc.); whatever view was in the pasted URL
is discarded and the app always fetches `CS`, since it's the one with
parseable per-check times.

`parseMotoTallyUrl(input)` extracts `{org, discipline, year, round, group}`
from the pasted URL and validates `discipline === 'Enduro'`. This composite
descriptor becomes the `raceId` used in this app's own deep-link param, e.g.
`?race=mototally:ECEA/Enduro/2026/6/O1&id=5018915` (URL-encoded).

## Architecture

New module, mirroring the shape of `livelaps.js` (which is left untouched):

```
src/
  mototally.js     parseMotoTallyUrl(input), fetchRace(descriptor),
                    fetchAllResults(descriptor) [parses mtR_gvResults via
                    DOMParser], loadRaceById(descriptor)
  raceSource.js     new: resolveAndLoadRace(input) dispatcher — tries
                    parseMotoTallyUrl() first; on no match, falls through to
                    livelaps.js's existing resolveAndLoadRace() unchanged
```

`search.js` and `main.js` switch their `resolveAndLoadRace` import from
`livelaps.js` to `raceSource.js`; no other change, since both sources
normalize to the same record shape (below).

## Data normalization

`mototally.js` parses the `mtR_gvResults` table (columns: `EventPlace`, `AMA#`,
`Row`, `Rider Name`, `Club`, `Sponsors`, `Brand`, `Class`, per-check columns,
`MaxChk`, `TotalTime`) into the same shape `livelaps.js` already produces, so
`dashboard.js`/`search.js` stay source-agnostic:

| Normalized field | Moto-Tally source |
|---|---|
| `id` | `AMA#` — stable per rider across events, plays the role LiveLaps' internal participant id plays |
| `fullName` | `Rider Name` |
| `displayedNumber` | `Row` (e.g. `22A`) |
| `className` | `Class` |
| `overallPosition` | `EventPlace` |
| `classPosition` | **derived**: rank within same-`className` entries in `allResults`, sorted by `TotalTime` — legitimate, since it's computed from the authoritative published total, not inferred per-check methodology |
| `overallBehindByLeader` / `classBehindByLeader` | **derived**: this racer's `TotalTime` minus the overall/class leader's `TotalTime` |
| `avgSpeedTotal` | **omitted** — Moto-Tally is penalty/time-card scoring, no speed concept exists |
| `sections[]` | one entry per check column with a nonzero value (checks reading `0` are untimed regular checkpoints, confirmed by summing the nonzero checks and matching `TotalTime` exactly); `totalCumulatedTime` computed by running sum, `sectionOverallPosition` from the check's `(place)` annotation |
| `sections[].overallBehindBy` | **derived**: gap to the immediately-ahead racer's `totalCumulatedTime` at that same section — safe, since it's arithmetic over the already-parsed per-check cumulative times, not an inferred ranking |
| `sections[].avgSpeed`, `sections[].classPosition` / `sectionClassPosition` | **omitted** — no per-check class standings or speed are published; inferring them from field-wide per-check times would be assuming a scoring methodology Moto-Tally doesn't confirm |

The distinction driving what's derived vs. omitted: race-final totals
(`TotalTime`, `EventPlace`) are authoritative published numbers, so ranking or
differencing them is safe. Per-check standings beyond the published overall
`(place)` are not published at all, so nothing is invented for them.

## UI changes

- `search.js`: subhead/placeholder text becomes source-agnostic ("Paste a
  LiveLaps or Moto-Tally results link…").
- `dashboard.js`: the average-speed stat tile, the average-speed-per-section
  bar chart, and the class-position-per-section line chart render only when
  the corresponding field is present on the record/series — Moto-Tally records
  simply omit them rather than showing zeroed/fake data. Everything else
  (position charts, cumulative time, gap-to-leader, table view) is unchanged.

## Error handling

Same pattern as the existing LiveLaps error handling in `search.js`:

- Unparseable/unrecognized input: existing `UnparseableInputError` message
  covers this already (dispatcher falls through when neither parser matches).
- Non-Enduro `discipline` segment: reuses `UnsupportedFormatError` with the
  existing copy.
- Proxy/fetch failure (nginx 502, moto-tally.com down, unexpected table
  markup): generic "Couldn't load that race — check the link and try again."
  — same fallback `search.js` already has for any non-typed error.

## Testing

- `parseMotoTallyUrl()` against a table of inputs: overall-grouping URL,
  class-grouping URL, non-Enduro discipline, garbage input — mirrors the
  existing `parseRaceId()` test table in `test/livelaps.test.js`.
- A fixture-based test (saved HTML snippet of `mtR_gvResults`, similar to
  `test/fixtures/results.fixture.js`) asserting the parsed record shape:
  correct `sections` (only nonzero checks), correct summed
  `totalCumulatedTime`, correct derived `classPosition`.
- `raceSource.js` dispatch test: LiveLaps input still routes to
  `livelaps.js`, Moto-Tally input routes to `mototally.js`.
- The nginx proxy itself and the dashboard's conditional (present/absent field)
  rendering are verified manually against the dev server, same as the existing
  search/dashboard toggle testing approach.

## Future Work

- [ ] If this app ever moves off self-hosted Docker+nginx, the proxy needs to
      move to whatever the new host supports (serverless function was the
      considered alternative — see "Why this needs a backend component").
