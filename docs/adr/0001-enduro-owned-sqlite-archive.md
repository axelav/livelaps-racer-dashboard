# Enduro-owned SQLite archive

Enduro Breakdown will own its archive API and SQLite database in its own deployed service. SQLite fits the small shared public archive and low write volume, while keeping timing-source ingestion, normalization, and archive reads within the product that owns their meaning; `interne` remains an unrelated application.
