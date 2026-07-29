# Enduro Breakdown

Enduro Breakdown presents section-by-section results from public enduro timing sources and retains them for later comparison.

## Language

**Race archive**:
The shared collection of persisted public race data available to every Enduro Breakdown visitor. A race enters the archive when the application successfully loads it from a timing source.
_Avoid_: User library, private cache

**Race snapshot**:
The immutable normalized results and race metadata captured from one timing source at a particular time, together with its original source artifact. Later fetches create later snapshots rather than replacing it.
_Avoid_: Live result, cached response

**Source race**:
A race as identified by one timing provider and that provider's race ID. Two providers' records remain distinct Source Races even when they describe the same real-world event.
_Avoid_: Canonical event, merged race

**Calendar metadata**:
The source-published event date, location, and organizer/club associated with a Source Race. For Moto-Tally, it is resolved from the matching organization, discipline, year, and round entry in its series calendar.
_Avoid_: Derived event, merged event data

**Source artifact**:
The unmodified API payload or source HTML from which a Race Snapshot is derived.
_Avoid_: Raw cache, scrape output

**Refresh**:
An explicit request to fetch a race from its timing source and create a later Race Snapshot. Normal archive views use the newest stored snapshot without fetching upstream.
_Avoid_: Reload, cache invalidation

**Archive ingestion**:
The act of adding a race to the shared Race Archive by successfully loading a supported public timing-source URL. Any visitor may initiate archive ingestion.
_Avoid_: Private import, curator approval

**Synchronous ingestion**:
Archive ingestion that completes its upstream fetch, normalization, and Race Snapshot creation within the initiating visitor's request.
_Avoid_: Background import, queued ingestion

**Archive backfill**:
An operator-run archive ingestion that discovers historical Source Races from a timing provider's published calendar and creates missing Race Snapshots without refreshing or replacing existing archived Source Races.
_Avoid_: Event import, bulk refresh

**Current snapshot**:
The newest successfully created Race Snapshot for an archived race. A failed Refresh never replaces it.
_Avoid_: Latest attempted fetch, stale cache

**Racer history**:
A racer-centric comparison that groups every archived Race Entry with an exact normalized name match. It is a browser-local view, not a shared racer record.
_Avoid_: Combined leaderboard, event standings

**Normalized racer name**:
A race entry's name after case, whitespace, punctuation, and diacritics are ignored for Racer History matching. It does not infer aliases, nicknames, or reordered names.
_Avoid_: Racer profile, fuzzy match

**History dashboard**:
The primary view of a Racer History, showing cross-race trends and a picker for its individual Race Entries.
_Avoid_: Race detail, combined leaderboard

**Race detail**:
The existing section-by-section breakdown for one Race Entry, selected from the History Dashboard.
_Avoid_: History dashboard, event list

**Performance percentile**:
A racer's relative placement within an overall field or class field, used to compare performance across races with different entrant counts.
_Avoid_: Raw placement, finish time

**Results ledger**:
The chronological list of exact per-race placements and times accompanying History Dashboard trends.
_Avoid_: Trend chart, combined leaderboard

**Race entry**:
One racer's result within a Race Snapshot.
_Avoid_: Racer, profile

**Anchor racer**:
The racer a view is built around. Every stat, placement, and comparison on
that view is stated from this racer's point of view, and adding others never
displaces them.
_Avoid_: Selected racer, primary rider

**Comparison rider**:
Another racer shown alongside the Anchor Racer for contrast. A Comparison
Rider is chosen by name and may come from any class; class is a label on the
comparison, never a filter on who may be chosen.
_Avoid_: Competitor, opponent, rival

**Comparison set**:
The Comparison Riders a visitor has chosen to show against the Anchor Racer.
It belongs to the address of the view, so it can be shared and revisited, and
is never a stored relationship between the racers themselves.
_Avoid_: Watchlist, rivals, followed racers

**Shared round**:
A race both the Anchor Racer and a Comparison Rider have a Race Entry in.
Only Shared Rounds support comparing placements directly; a round only one of
them rode is an absence, not a poor result.
_Avoid_: Common race, overlap

**Head-to-head record**:
How often the Anchor Racer finished ahead of a Comparison Rider across their
Shared Rounds. It counts rounds, never margins, and says nothing about rounds
only one of them entered.
_Avoid_: Season standings, championship points
