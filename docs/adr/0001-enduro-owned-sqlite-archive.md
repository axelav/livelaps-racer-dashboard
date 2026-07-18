# Enduro-owned SQLite archive

Enduro Breakdown will own its archive API and SQLite database in its own deployed service. SQLite fits the small shared public archive and low write volume; it stores both normalized snapshots and compressed source artifacts so each archive write is atomic and backup is straightforward. Timing-source ingestion, normalization, and archive reads remain within the product that owns their meaning; `interne` remains an unrelated application.
