# Enduro Race Archive and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist public LiveLaps and Moto-Tally race snapshots in a shared SQLite archive and show automatic cross-race racer history alongside switchable race detail.

**Architecture:** Replace the static nginx image with one Node service that serves `dist/` and a same-origin `/api` boundary. Server-owned source adapters write immutable source snapshots and compressed source artifacts to SQLite; the frontend reads current snapshots and history queries only. Deliver this as an archive foundation first, then a history dashboard that groups all archive entries by normalized racer name.

**Tech Stack:** Node 22 ESM, Express, better-sqlite3, linkedom, Vite, Vitest, happy-dom, Docker, SQLite.

## Global Constraints

- Accept only canonicalized LiveLaps and Moto-Tally source inputs; never proxy arbitrary URLs.
- Keep LiveLaps and Moto-Tally Source Races distinct even for the same real-world event.
- Store each successful ingestion/refresh as an immutable, timestamped snapshot with a compressed raw source artifact; retain them indefinitely.
- Serve the newest successful snapshot by default; only explicit refresh fetches upstream.
- Preserve a current snapshot when refresh or Moto-Tally calendar enrichment fails.
- Group Racer History with normalized names only: case/whitespace/punctuation/diacritic insensitive; no aliases or fuzzy matching.
- History includes every matching archived race, not a manually selected set. Persist only the viewed racer name in `localStorage`.
- Use signed conventional commits after every independently green task.

---

## File structure

- `server/index.js` — production HTTP entry point; serves API and Vite build.
- `server/app.js` — `createApp({ archive, sources, limiter })` and HTTP routes.
- `server/archive/database.js` — opens SQLite, runs ordered migrations, closes DB.
- `server/archive/repository.js` — Source Race, snapshot, catalog, current-snapshot, and history persistence/query boundary.
- `server/archive/history.js` — normalized-name and percentile transformations shared by repository/API tests.
- `server/sources/input.js` — supported-input canonicalization and source identity extraction.
- `server/sources/livelaps.js` — server LiveLaps fetcher returning normalized result + raw JSON + event date.
- `server/sources/mototally.js` — server Moto-Tally fetcher returning normalized result + raw HTML + calendar metadata.
- `server/sources/index.js` — dispatches only supported canonical source inputs.
- `server/compression.js` — gzip/gunzip raw artifact bytes.
- `src/api.js` — browser API client; no provider calls.
- `src/archive.js` — archive catalog/add/refresh UI controller.
- `src/history.js` — history panel renderer and browser-local racer-name preference.
- `src/main.js`, `src/search.js`, `src/dashboard.js`, `src/style.css` — consume archive/current-snapshot/history APIs and render the stable split dashboard.
- `test/server/*.test.js` — repository, source, API, and history regression coverage.
- `Dockerfile`, `vite.config.js`, `package.json`, `../honkytonk-infra/docker-compose.yml` — Node runtime, dev proxy/scripts, dependencies, and persistent `enduro-data` volume.

## Slice 1 — Archive foundation

### Task 1: Add server runtime dependencies and a source-input boundary

**Files:**
- Modify: `package.json`, `vite.config.js`
- Create: `server/sources/input.js`, `server/compression.js`, `test/server/input.test.js`, `test/server/compression.test.js`

**Interfaces:**

```js
// server/sources/input.js
export function canonicalizeSourceInput(input) {
  // { provider: 'livelaps' | 'mototally', sourceRaceId: string, canonicalUrl: string, descriptor?: object }
}

// server/compression.js
export function compressArtifact(text) {}
export function decompressArtifact(blob) {}
```

- [ ] **Step 1: Add dependencies and development commands.**

```json
{
  "scripts": {
    "dev": "vite",
    "dev:api": "node server/index.js",
    "start": "node server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "express": "^5.0.0",
    "linkedom": "^0.18.0"
  }
}
```

Add `server: { proxy: { '/api': 'http://localhost:3000' } }` to `vite.config.js`; remove the browser Moto-Tally proxy.

- [ ] **Step 2: Write failing input and compression tests.**

```js
expect(canonicalizeSourceInput('79103')).toMatchObject({ provider: 'livelaps', sourceRaceId: '79103' });
expect(canonicalizeSourceInput('https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2026/6/O1/CS'))
  .toMatchObject({ provider: 'mototally', sourceRaceId: 'ECEA/Enduro/2026/6/O1' });
expect(() => canonicalizeSourceInput('https://example.com/internal')).toThrow(/supported/);
expect(decompressArtifact(compressArtifact('<html>race</html>'))).toBe('<html>race</html>');
```

- [ ] **Step 3: Run the focused tests and confirm they fail.**

Run: `pnpm test -- test/server/input.test.js test/server/compression.test.js`

Expected: FAIL because the server modules do not exist.

- [ ] **Step 4: Implement canonicalization and gzip helpers.**

```js
import { gzipSync, gunzipSync } from 'node:zlib';
export const compressArtifact = (text) => gzipSync(Buffer.from(text, 'utf8'));
export const decompressArtifact = (blob) => gunzipSync(blob).toString('utf8');
```

Use existing `parseRaceId`, `isMotoTallyUrl`, and `parseMotoTallyUrl` parsing rules; reject every unsupported URL before `fetch` can be reached.

- [ ] **Step 5: Verify and commit.**

Run: `pnpm test -- test/server/input.test.js test/server/compression.test.js && pnpm build`

```bash
git add package.json pnpm-lock.yaml vite.config.js server/sources/input.js server/compression.js test/server
git commit -S -m "feat(archive): add source input boundary"
```

### Task 2: Make server-owned provider adapters return archive-ready records

**Files:**
- Create: `server/sources/livelaps.js`, `server/sources/mototally.js`, `server/sources/index.js`, `test/server/sources.test.js`
- Modify: `src/livelaps.js`, `src/mototally.js`

**Interfaces:**

```js
// common adapter output
{
  sourceRace: { provider, sourceRaceId, canonicalUrl, raceName, modeName, eventDate, location, organizer },
  normalized: { raceMeta, allResults },
  artifact: { mimeType: 'application/json' | 'text/html', text }
}

export function createSources({ fetchImpl, parseHtml }) {
  return { load(input), refresh(sourceRace) };
}
```

- [ ] **Step 1: Write failing adapter tests with injected fetch fixtures.**

```js
const sources = createSources({ fetchImpl: mockFetch, parseHtml: (html) => new DOMParser().parseFromString(html, 'text/html') });
const loaded = await sources.load('79103');
expect(loaded.sourceRace.eventDate).toBe('2026-07-12');
expect(loaded.artifact.mimeType).toBe('application/json');
expect(loaded.normalized.allResults).toHaveLength(2);
```

Add a Moto-Tally test whose calendar fixture has `Race#`, `Date`, location, and club; assert calendar metadata is present. Add a calendar-fetch failure test that still returns valid normalized results with null metadata.

- [ ] **Step 2: Run and confirm the tests fail.**

Run: `pnpm test -- test/server/sources.test.js`

- [ ] **Step 3: Extract pure parser/derivation helpers from browser modules.**

Keep `parseRaceId`, standings derivation, and DOM parsing pure. Change network functions to receive `fetchImpl` and let `server/sources/*` call provider URLs directly. In the Moto-Tally adapter, fetch `/{org}/{discipline}/Results.aspx`, select the row whose year/round matches the descriptor, and parse its date/location/club.

- [ ] **Step 4: Implement the dispatcher.**

```js
export function createSources(deps) {
  return {
    load(input) { return canonicalizeSourceInput(input).provider === 'mototally' ? loadMotoTally(input, deps) : loadLiveLaps(input, deps); },
    refresh(sourceRace) { return this.load(sourceRace.canonicalUrl); }
  };
}
```

- [ ] **Step 5: Verify and commit.**

Run: `pnpm test -- test/server/sources.test.js test/mototally-parse.test.js test/livelaps.test.js`

```bash
git add src/livelaps.js src/mototally.js server/sources test/server/sources.test.js
git commit -S -m "feat(archive): add server timing source adapters"
```

### Task 3: Create the SQLite archive repository and migrations

**Files:**
- Create: `server/archive/database.js`, `server/archive/repository.js`, `server/archive/history.js`, `server/archive/migrations/001-initial.sql`, `test/server/repository.test.js`

**Interfaces:**

```js
export function openDatabase(filename) {}
export function createArchive(db) {
  return {
    saveSnapshot(loaded, capturedAt),
    getCurrentSnapshot(sourceRaceId),
    findCatalog({ query, limit }),
    findHistory(normalizedName)
  };
}
export function normalizeRacerName(name) {}
export function toPercentile(position, fieldSize) {}
```

- [ ] **Step 1: Write failing repository tests against `:memory:`.**

```js
const archive = createArchive(openDatabase(':memory:'));
await archive.saveSnapshot(liveLapsLoaded, '2026-07-17T00:00:00.000Z');
await archive.saveSnapshot(liveLapsLoaded, '2026-07-17T01:00:00.000Z');
expect(archive.getCurrentSnapshot('livelaps:79103').capturedAt).toBe('2026-07-17T01:00:00.000Z');
expect(archive.findHistory(normalizeRacerName('Áxel-Anderson'))).toHaveLength(2);
```

Also assert: raw artifact round-trips through compression; provider/source IDs are unique Source Race keys; LiveLaps and Moto-Tally rows with identical names/dates remain separate; and a failed refresh performs no write.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm test -- test/server/repository.test.js`

- [ ] **Step 3: Write migration and repository implementation.**

The migration creates `source_races`, `race_snapshots`, `race_entries`, and `race_sections`. `source_races` has `provider`, `source_race_id`, `canonical_url`, calendar metadata, and `current_snapshot_id`; `race_snapshots` has capture timestamp, artifact MIME type/blob, normalized race JSON, and a foreign key to `source_races`. Persist searchable scalar columns for the catalog/history and full normalized data for faithful race-detail reconstruction.

- [ ] **Step 4: Implement normalization and percentiles.**

```js
export function normalizeRacerName(name) {
  return name.normalize('NFKD').replace(/\\p{Diacritic}/gu, '').replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim().toLocaleLowerCase();
}
export const toPercentile = (position, size) => size ? Math.round((1 - (position - 1) / size) * 100) : null;
```

- [ ] **Step 5: Verify and commit.**

Run: `pnpm test -- test/server/repository.test.js`

```bash
git add server/archive test/server/repository.test.js
git commit -S -m "feat(archive): persist immutable race snapshots"
```

### Task 4: Expose the archive API with rate limits and failure semantics

**Files:**
- Create: `server/app.js`, `server/index.js`, `server/rate-limit.js`, `test/server/app.test.js`

**Interfaces:**

```js
export function createApp({ archive, sources, limiter }) {}
// POST /api/archive/ingest { input } -> { sourceRace, snapshot }
// POST /api/source-races/:id/refresh -> { sourceRace, snapshot, refreshed: true }
// GET /api/source-races/:id -> { sourceRace, snapshot }
// GET /api/archive?q=term -> { races: [] }
// GET /api/history/:normalizedName -> { racerName, races: [], trends: {} }
```

- [ ] **Step 1: Write failing HTTP tests.**

```js
const response = await request(app).post('/api/archive/ingest').send({ input: '79103' });
expect(response.status).toBe(201);
expect(response.body.snapshot.allResults).toHaveLength(2);

await request(app).post('/api/source-races/livelaps%3A79103/refresh');
sources.refresh.mockRejectedValueOnce(new Error('503'));
const failed = await request(app).post('/api/source-races/livelaps%3A79103/refresh');
expect(failed.status).toBe(503);
expect(archive.getCurrentSnapshot('livelaps:79103')).toBeDefined();
```

Test unsupported host rejection before adapter invocation, requester/source-rate-limit 429 responses, catalog search, and normalized-name history results.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm test -- test/server/app.test.js`

- [ ] **Step 3: Implement routes and in-memory rate limiter.**

Use `req.ip` plus a source-race key. Return structured `{ error, currentSnapshot? }` JSON. On a refresh adapter error, do not call `saveSnapshot`; return the existing snapshot metadata when available.

- [ ] **Step 4: Implement production entry point.**

```js
const db = openDatabase(process.env.ENDURO_DB_PATH ?? '/data/enduro.db');
const app = createApp({ archive: createArchive(db), sources: createSources({ fetchImpl: fetch, parseHtml }), limiter: createLimiter() });
app.use(express.static(new URL('../dist', import.meta.url).pathname));
app.get('*', (_, res) => res.sendFile(new URL('../dist/index.html', import.meta.url).pathname));
app.listen(process.env.PORT ?? 3000);
```

- [ ] **Step 5: Verify and commit.**

Run: `pnpm test -- test/server/app.test.js && pnpm test`

```bash
git add server test/server/app.test.js
git commit -S -m "feat(archive): serve persistent archive api"
```

### Task 5: Deploy the Node service and archive-first single-race UI

**Files:**
- Modify: `Dockerfile`, `nginx.conf` (delete), `src/api.js` (create), `src/main.js`, `src/search.js`, `src/dashboard.js`, `src/style.css`, `test/search.test.js`
- Modify: `../honkytonk-infra/docker-compose.yml`

**Interfaces:**

```js
// src/api.js
export const archiveApi = {
  search: (query) => get(`/api/archive?q=${encodeURIComponent(query)}`),
  ingest: (input) => post('/api/archive/ingest', { input }),
  refresh: (id) => post(`/api/source-races/${encodeURIComponent(id)}/refresh`),
  sourceRace: (id) => get(`/api/source-races/${encodeURIComponent(id)}`)
};
```

- [ ] **Step 1: Write failing browser tests.**

Test that a known race renders from `archiveApi.sourceRace` without calling provider functions, a submitted new URL calls `archiveApi.ingest`, and refresh failure keeps dashboard results visible with an error notice.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm test -- test/search.test.js`

- [ ] **Step 3: Replace frontend provider calls with `archiveApi`.**

Remove `resolveAndLoadRace`/`loadRaceById` usage from `src/main.js` and `src/search.js`. Render catalog search plus “Paste a new race link”; retain current Race Detail UI and add an explicit Refresh button showing capture time.

- [ ] **Step 4: Replace nginx runtime with Node runtime.**

Use a Node 22 Alpine build stage with `python3 make g++` for `better-sqlite3`, build Vite, then copy `dist`, `server`, package files, and compatible `node_modules` into a Node 22 Alpine runtime. Expose port 3000 and run `node server/index.js`.

Update the infrastructure service:

```yaml
enduro:
  environment:
    - ENDURO_DB_PATH=/data/enduro.db
  volumes:
    - enduro-data:/data
  labels:
    - "traefik.http.services.enduro.loadbalancer.server.port=3000"
volumes:
  enduro-data:
```

- [ ] **Step 5: Verify and commit Slice 1.**

Run: `pnpm test && pnpm build && docker build -t enduro-archive .`

```bash
git add Dockerfile nginx.conf src/api.js src/main.js src/search.js src/dashboard.js src/style.css test/search.test.js
git commit -S -m "feat(archive): use archived races in dashboard"
git -C ../honkytonk-infra add docker-compose.yml
git -C ../honkytonk-infra commit -S -m "feat(enduro): add persistent archive volume"
```

## Slice 2 — Racer history

### Task 6: Add history API contract and trend regression tests

**Files:**
- Modify: `server/archive/repository.js`, `server/app.js`, `server/archive/history.js`, `test/server/repository.test.js`, `test/server/app.test.js`

**Interfaces:**

```js
export function buildRacerHistory(entries) {
  return {
    racerName: entries[0]?.fullName ?? null,
    races: [{ sourceRaceId, raceName, eventDate, provider, overallPosition, fieldSize, overallPercentile, classPosition, classSize, classPercentile, totalTimeSeconds }],
    trends: { overallPercentiles: [], classPercentiles: [] }
  };
}
```

- [ ] **Step 1: Write failing history tests.**

```js
expect(buildRacerHistory(entriesNamed('Áxel-Anderson', 'AXEL ANDERSON')).races).toHaveLength(2);
expect(buildRacerHistory(entries).trends.overallPercentiles).toEqual([94, 75]);
expect(history.races.map((race) => race.provider)).toEqual(['livelaps', 'mototally']);
```

Include same-name entries from distinct providers and Source Races; assert both appear. Include unmatched reordered/alias names and assert neither is included.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm test -- test/server/repository.test.js test/server/app.test.js`

- [ ] **Step 3: Implement chronological history query.**

Order by source event date when present, then capture time; return the date provenance needed for an unavailable/estimated label. Return every matching current archive entry without a client-provided race set.

- [ ] **Step 4: Verify and commit.**

Run: `pnpm test -- test/server/repository.test.js test/server/app.test.js`

```bash
git add server/archive server/app.js test/server/repository.test.js test/server/app.test.js
git commit -S -m "feat(history): expose racer trends across archive"
```

### Task 7: Render the stable history dashboard and local racer preference

**Files:**
- Create: `src/history.js`, `test/history.test.js`
- Modify: `src/api.js`, `src/main.js`, `src/dashboard.js`, `src/style.css`

**Interfaces:**

```js
export function loadSavedRacerName(storage = localStorage) {}
export function saveRacerName(name, storage = localStorage) {}
export function clearSavedRacerName(storage = localStorage) {}
export function renderHistory(container, { history, selectedSourceRaceId, onSelectRace, onClear }) {}
```

- [ ] **Step 1: Write failing history renderer tests.**

```js
renderHistory(container, { history, selectedSourceRaceId: 'livelaps:79103', onSelectRace, onClear });
expect(container.textContent).toContain('Overall percentile');
expect(container.textContent).toContain('Results ledger');
container.querySelector('[data-slot="racePicker"]').value = 'mototally:ECEA/Enduro/2026/6/O1';
container.querySelector('[data-slot="racePicker"]').dispatchEvent(new Event('change'));
expect(onSelectRace).toHaveBeenCalledWith('mototally:ECEA/Enduro/2026/6/O1');
```

Test `localStorage` name save/load/clear and that the race picker changes detail without changing the history panel's trend/ledger data.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm test -- test/history.test.js`

- [ ] **Step 3: Implement `src/history.js`.**

Render both percentile trend charts and the chronological ledger in the history panel. Include source badge, date provenance, raw position/field/class/time. Use a `<select data-slot="racePicker">` whose values are Source Race IDs and whose change callback drives only selected race detail.

- [ ] **Step 4: Wire history into the dashboard flow.**

After selecting a race entry, call `archiveApi.history(normalizeRacerName(racer.fullName))`, save the normalized name, and render a two-panel layout. Fetch/render selected detail independently when the picker changes. Add a visible clear-history action that removes only the saved `localStorage` preference.

- [ ] **Step 5: Verify and commit Slice 2.**

Run: `pnpm test && pnpm build`

```bash
git add src/history.js src/api.js src/main.js src/dashboard.js src/style.css test/history.test.js
git commit -S -m "feat(history): show archived racer trends"
```

### Task 8: Verify production behavior and document operations

**Files:**
- Modify: `README.md` (create if absent), `docs/superpowers/specs/2026-07-17-enduro-race-archive-and-history-design.md`
- Test: `test/server/app.test.js`, manual Docker verification

- [ ] **Step 1: Add operational documentation.**

Document `ENDURO_DB_PATH`, the `enduro-data` Docker volume, backup command, archive-first/refresh behavior, supported providers, and how to restore a SQLite backup before starting the service.

- [ ] **Step 2: Add an end-to-end API flow test.**

```js
const created = await request(app).post('/api/archive/ingest').send({ input: liveLapsUrl });
const history = await request(app).get(`/api/history/${encodeURIComponent(normalizeRacerName('Axel Anderson'))}`);
expect(history.body.races).toContainEqual(expect.objectContaining({ sourceRaceId: created.body.sourceRace.id }));
```

- [ ] **Step 3: Build and run the production image.**

Run: `docker build -t enduro-archive . && docker run --rm -d --name enduro-archive-test -p 3000:3000 -v enduro-archive-test-data:/data enduro-archive`

Run: `curl --fail http://localhost:3000/api/archive && curl --fail http://localhost:3000/`

Expected: API returns JSON; frontend returns the Vite HTML shell.

- [ ] **Step 4: Stop the test container and commit.**

Run: `docker stop enduro-archive-test`

```bash
git add README.md docs/superpowers/specs/2026-07-17-enduro-race-archive-and-history-design.md test/server/app.test.js
git commit -S -m "docs(enduro): document archive operations"
```

## Future Work

- [ ] Evaluate an alternate layout that renders historical trends below the selected race detail; keep it only if it proves clearer without hiding or shifting trend context.
- [ ] Add an automatic refresh policy for recently completed events, while retaining explicit refresh as the default.
- [ ] Add a protected admin workflow to import or scrape an entire LiveLaps or Moto-Tally series using background jobs.
- [ ] Add deliberate cross-provider event reconciliation only if users need one canonical event view; never infer it automatically.
- [ ] Add richer rider identity matching (such as AMA-number evidence and confirmed profiles) if exact normalized names become insufficient.
