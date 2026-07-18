# Enduro Race Archive and Racer History Design

## Goal

Turn Enduro Breakdown from a browser-only, single-race dashboard into a shared archive of public enduro results. Any visitor can add a supported timing-source race; everyone can reuse its archived data. A racer view then shows that racer's trends across every archived race with the same normalized name and lets the visitor drill into an individual race.

## Scope

The first release has two vertical slices.

1. **Archive slice:** replace browser-owned source fetching with a Node service and SQLite archive while retaining the existing single-race dashboard.
2. **History slice:** add an all-archived-events history dashboard, percentile trends, a results ledger, and a race-detail picker.

This is deliberately not a canonical event system, a user-account system, or a bulk-series importer.

## Architecture

Enduro runs as one Node service. It serves the Vite-built frontend and a same-origin archive API. The browser reads only that API; it never fetches LiveLaps or Moto-Tally directly.

The service owns these responsibilities:

- Canonicalize and validate submitted inputs.
- Accept only LiveLaps and Moto-Tally URLs or IDs.
- Fetch, normalize, and archive supported source results.
- Apply requester and source-race rate limits.
- Serve current archived snapshots and racer-history queries.

SQLite is mounted on a persistent Docker volume owned by Enduro. It stores normalized archive records and compressed source artifacts together, so an archive write is atomic and a single backup contains the complete archive.

## Archive model

### Source race

A Source Race is identified by a provider plus that provider's stable race ID. It has a canonical source URL, race name, mode, optional source event date, and optional calendar metadata.

LiveLaps and Moto-Tally records remain distinct Source Races even if they describe the same real-world event. The application does not merge their results.

### Race snapshot

Each successful ingestion or explicit refresh creates an immutable, timestamped Race Snapshot. A snapshot contains:

- Normalized race metadata and all normalized race entries/sections needed by the dashboard.
- A compressed, unmodified source artifact: API payload for LiveLaps or HTML for Moto-Tally.
- Capture time and provider provenance.

Snapshots and artifacts are retained indefinitely in v1. The newest successful snapshot is the Source Race's Current Snapshot. A failed refresh never changes the Current Snapshot.

### Calendar metadata

LiveLaps supplies an event date directly. Moto-Tally ingestion additionally fetches the matching organization/discipline series calendar and resolves its year and round to capture event date, location, and organizer/club. Calendar lookup failure does not prevent otherwise valid result ingestion; those fields remain absent.

## Ingestion and refresh

Any visitor may paste a supported source URL or ID.

- An unarchived source race is ingested synchronously: fetch, normalize, persist, then return the resulting Current Snapshot.
- A normal open of an archived source race reads its Current Snapshot without an upstream fetch.
- An explicit Refresh synchronously attempts a new snapshot.
- On refresh failure, Enduro preserves and serves the Current Snapshot with its capture time and shows a non-blocking failure notice.

The server rejects any non-LiveLaps/Moto-Tally host or path before making a network request. It rate-limits ingestion and refreshes by requester and Source Race.

## Racer history

A Racer History is browser-local. It has no shared racer profile or manual global identity links.

The history query groups every archived Race Entry whose normalized racer name matches. Normalization ignores case, repeated/surrounding whitespace, punctuation, and diacritics; it does not infer aliases, nicknames, or reordered names. The original source spelling remains visible in race details.

`localStorage` remembers the currently viewed normalized racer name and provides a clear action. It does not store a manually selected set of races, because the history automatically includes all matching archive entries.

## History dashboard

The History Dashboard is the primary racer experience. It keeps two stable panels visible:

- **History panel:** overall-field percentile and class-field percentile trends across every matching archived Race Entry, followed by a chronological results ledger with source, event date, exact placement, field/class size, and time.
- **Race detail panel:** the existing section-by-section dashboard for one selected race.

A race dropdown changes only the Race Detail panel. History trends and ledger remain stable, preventing the historical view from disappearing or jumping when a visitor switches races.

Percentiles are the primary trend metrics because raw placement and total time are not comparable across courses and field sizes. The ledger retains those raw values for context.

## API shape

The exact route names may evolve, but the boundary is:

- Archive catalog/search and Source Race lookup.
- Ingest a supported source input.
- Refresh a Source Race.
- Read a Source Race's Current Snapshot and selected snapshot metadata.
- Query all archived entries for a normalized racer name, including trend-ready aggregate fields and selectable race details.

The frontend consumes normalized API representations only. Provider adapters remain internal server modules.

## Error handling

- Invalid or unsupported input: reject before network access with actionable input feedback.
- Provider fetch/parse failure during first ingestion: do not create a Current Snapshot; report the failure.
- Refresh failure: retain Current Snapshot and report a non-blocking failure.
- Missing Moto-Tally calendar metadata: archive valid results without those optional fields.
- Unmatched racer name in another archive entry: do not include it in the history.

## Verification

Tests cover:

- Supported-source validation and canonicalization.
- Source Race/Snapshot persistence, source-artifact retention, and Current Snapshot selection.
- Synchronous ingestion and refresh failure preservation.
- LiveLaps event-date persistence and Moto-Tally calendar resolution.
- Provider provenance: no automatic cross-provider race merge.
- Exact normalized-name grouping, percentile calculation, and local saved racer selection.
- API-to-frontend archive and history flows.

## Delivery slices

### Slice 1 — Archive foundation

- Introduce the Node service, SQLite schema/migrations, persistent Docker volume, and API boundary.
- Move LiveLaps and Moto-Tally fetching/normalization server-side.
- Persist Source Races, immutable snapshots, artifacts, and current-snapshot metadata.
- Add archive lookup, add-race, and refresh UI while preserving the current detailed dashboard.

### Slice 2 — Racer history

- Add normalized-name history queries across all archived entries.
- Add the history dashboard with percentile trends and ledger.
- Add the stable race-detail dropdown/panel and browser-local saved racer name.

## Future Work

- [ ] Evaluate an alternate layout that renders historical trends below the selected race detail; keep it only if it proves clearer without hiding or shifting trend context.
- [ ] Add an automatic refresh policy for recently completed events, while retaining explicit refresh as the default.
- [ ] Add a protected admin workflow to import or scrape an entire LiveLaps or Moto-Tally series using background jobs.
- [ ] Add deliberate cross-provider event reconciliation only if users need one canonical event view; never infer it automatically.
- [ ] Add richer rider identity matching (such as AMA-number evidence and confirmed profiles) if exact normalized names become insufficient.
