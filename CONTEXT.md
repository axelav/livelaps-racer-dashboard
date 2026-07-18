# Enduro Breakdown

Enduro Breakdown presents section-by-section results from public enduro timing sources and retains them for later comparison.

## Language

**Race archive**:
The shared collection of persisted public race data available to every Enduro Breakdown visitor. A race enters the archive when the application successfully loads it from a timing source.
_Avoid_: User library, private cache

**Race snapshot**:
The immutable normalized results and race metadata captured from one timing source at a particular time, together with its original source artifact. Later fetches create later snapshots rather than replacing it.
_Avoid_: Live result, cached response

**Source artifact**:
The unmodified API payload or source HTML from which a Race Snapshot is derived.
_Avoid_: Raw cache, scrape output

**Racer history**:
A racer-centric comparison of that racer's results across selected archived races.
_Avoid_: Combined leaderboard, event standings

**Racer profile**:
A shared identity record that groups Race Entries confirmed to belong to one real racer.
_Avoid_: Source participant, unverified name match

**Race entry**:
One racer's result within a Race Snapshot. A Race Entry may be linked to a Racer Profile only through a persisted confirmation.
_Avoid_: Racer, profile

**Identity evidence**:
A source-supplied value that helps suggest a Racer Profile link, such as a Moto-Tally AMA number, a source participant ID, or a normalized name. It never replaces confirmation.
_Avoid_: Identity, proof
