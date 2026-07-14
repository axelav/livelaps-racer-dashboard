# LiveLaps Racer Dashboard — Design

## Purpose

A small public webapp that lets anyone look up a single racer's section-by-section
breakdown from a LiveLaps enduro race (position trajectory, pace, gaps to the
rider ahead) and get a shareable link to it. This generalizes the one-off
dashboard built earlier for a single racer (Axel Anderson, race 79103) into a
tool that works for any racer in any section-based LiveLaps race.

## Non-goals (v1)

- Race formats without a `sections` array on results entries (motocross, hare
  scrambles, etc.) — out of scope, see Error handling.
- Any backend/server component — the LiveLaps API's CORS policy allows direct
  browser calls (`Access-Control-Allow-Origin` reflects any origin), so this is
  a pure static site.
- Authentication, saved history, or comparing multiple racers against each other.

## Identifier design

The hard part of this problem is: what does a user type in to find "their"
result? Three LiveLaps-provided identifiers were considered:

- **Name** — not unique; multiple racers can share a name.
- **LiveLaps participant/result ID** (e.g. `4758874`) — unique and exactly what
  the API needs, but nobody has this memorized or bookmarked.
- **Bib number** (`displayedNumber`, e.g. `34D`) — human-known, but still needs
  disambiguation by race, and isn't exposed by any of the pasteable URLs.

Resolution: `race/filters/{raceId}` returns every participant as
`{value: <id>, text: "Full Name - BibNumber"}`, and `value` is confirmed to be
the exact same `id` used in `race/results/{raceId}`. So the app never asks for
an ID directly — the user pastes anything identifying the **race** (a LiveLaps
URL or a bare numeric ID), and then finds themselves via a type-ahead search
over that race's participant list (by name or bib), which resolves to the
unambiguous internal ID under the hood.

## Architecture

Vite + vanilla JS (via pnpm), no framework, no backend. Deployed as a static
site; specific host (Vercel/Netlify/GitHub Pages) is undecided and doesn't
affect the build — plain static output.

```
src/
  main.js        entry: parses the URL, toggles between Search and Dashboard
                 views, wires history.pushState/popstate for deep links
  livelaps.js    API layer: parseRaceId(input), fetchRace(id), fetchAllResults(id)
  search.js      race-URL/ID input + type-ahead-over-participants UI
  dashboard.js   renders stat tiles + charts for one racer record
  charts.js      pure, reusable SVG chart helpers (lineChart, barChart,
                 niceTicks, scaleY, roundedTopRectPath) — extracted from the
                 original single-racer dashboard artifact
  style.css
index.html
```

It's a single-page app: selecting a racer swaps the visible view via JS and
calls `history.pushState` to `?race={raceId}&id={participantId}` — no full page
reload. A direct visit to a URL with both params skips straight to fetching
that race and rendering the matching racer.

## Data flow

1. User pastes a LiveLaps URL or bare race ID. `parseRaceId()` regexes the
   numeric race ID out of any of the known URL shapes (`race/results/`,
   `race/filters/`, `race/config/`, `race/`, `eventScores/`) or accepts a bare
   number.
2. Fetch `race/{id}` (race name, mode) and `race/results/{id}` **once, fully
   paginated** (`size=1000`, looping while `has_more_pages`) — this single
   fetch is the source of truth for both the type-ahead list (built from
   `fullName` + `displayedNumber` + `id` on every entry) and the derived totals
   (field size = `total`; class size = count of entries sharing the selected
   racer's `className`).
3. User picks a racer from the type-ahead results. No second network call is
   needed — the matching entry (including its `sections` array) is already in
   the fetched payload.
4. `history.pushState` to `?race={id}&id={participantId}`; render the
   dashboard from that entry.

This was chosen over the more surgical `race/results/{id}?participant={id}`
filter (confirmed to work server-side, returns just one entry) because
fetch-once-use-everywhere keeps the type-ahead list and the rendered totals
always consistent with each other from a single source of truth, at the cost
of one moderately-sized request per race instead of two small ones — an
acceptable trade for a low-traffic tool.

## Dashboard content (per racer)

Ported from the original artifact, parameterized by the fetched record instead
of a hardcoded object:

- Stat tiles: overall position/field size, class position/class size, gap to
  overall & class leader, average speed.
- Line chart: overall position across sections (single series).
- Line chart: class position across sections (single series).
- Line chart: cumulative overall position vs. that section's rank in isolation
  (two series, shared axis, legend) — the chart that surfaces stories like "the
  late jump in position wasn't a pace surge, it was attrition ahead."
- Bar chart: average speed per section.
- Bar chart: gap (seconds) to the rider ahead, per section.
- Collapsible table view of the same per-section data, for accessibility.

## Error handling

- **Unparseable input**: inline error — "Couldn't find a race ID in that — try
  pasting a LiveLaps race/results/event URL, or just the number."
- **Race fetch fails** (404/network/non-JSON): inline error with a retry
  button; no raw API/stack output shown to the user.
- **Race has no `sections`** on its entries: "This race format isn't supported
  yet — Racer Breakdown currently works with section-based (enduro) races."
  instead of attempting to render broken charts.
- **No participants match the search text**: "No one matches '<query>' in this
  race."
- **Deep link with a race/id pair that doesn't resolve** (bad race ID, or that
  participant isn't in this race): falls back to the search screen (for that
  race, or blank if the race fetch itself failed) with a small dismissible
  notice explaining why.
- Console.error retains details for debugging; user-facing copy never leaks
  raw API responses.

## Testing

Vitest, focused on pure logic rather than DOM/e2e (thin client over a
third-party API with no control over its data):

- `parseRaceId()` against a table of inputs: bare number, each known URL shape,
  garbage input, empty string.
- `niceTicks()` / `scaleY()`: exact-output assertions across known ranges,
  including degenerate/flat domains (e.g. class position barely moving across
  sections).
- A fixture-based test asserting that a canned `sections`-shaped API response
  produces the expected derived values (field size, class size, chart series
  arrays) — guards the fetch-once data-shaping logic without hitting the real
  network.

The search/dashboard toggle, error states, and light/dark rendering are
verified manually against the dev server before shipping.

## Open items for later (not blocking v1)

- Hosting provider (Vercel vs. Netlify vs. GitHub Pages) — decide once the app
  works locally; no build changes needed either way.
