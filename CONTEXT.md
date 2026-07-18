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

**Refresh**:
An explicit request to fetch a race from its timing source and create a later Race Snapshot. Normal archive views use the newest stored snapshot without fetching upstream.
_Avoid_: Reload, cache invalidation

**Archive ingestion**:
The act of adding a race to the shared Race Archive by successfully loading a supported public timing-source URL. Any visitor may initiate archive ingestion.
_Avoid_: Private import, curator approval

**Racer history**:
A racer-centric comparison that groups selected Race Entries by an exact normalized name across archived races. It is a browser-local view, not a shared racer record.
_Avoid_: Combined leaderboard, event standings

**Saved selection**:
The browser-local record of a visitor's chosen archive races and racer-history name, which can be cleared by that visitor.
_Avoid_: Shared profile, user account

**Race entry**:
One racer's result within a Race Snapshot.
_Avoid_: Racer, profile
