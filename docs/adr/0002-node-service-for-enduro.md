# Node service for Enduro

Enduro Breakdown will evolve from a static nginx deployment into one Node service that serves the built frontend and its archive API. Browsers read only Enduro's API; the service owns public timing-source fetches, normalization, and SQLite writes. It accepts only canonicalized LiveLaps and Moto-Tally inputs, with rate limits by requester and source race, rather than becoming a general-purpose server-side fetch endpoint. This keeps those responsibilities in the existing JavaScript product rather than creating a separate Rust service and cross-service API boundary.
