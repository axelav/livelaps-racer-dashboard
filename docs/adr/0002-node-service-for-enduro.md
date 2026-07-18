# Node service for Enduro

Enduro Breakdown will evolve from a static nginx deployment into one Node service that serves the built frontend and its archive API. This keeps public timing-source fetches, normalization, and SQLite writes in the existing JavaScript product rather than creating a separate Rust service and cross-service API boundary.
