# Enduro Breakdown

Enduro Breakdown is a shared archive and racer-history dashboard for public
LiveLaps and Moto-Tally enduro results. The browser talks only to Enduro's
same-origin API; timing providers are fetched by the server.

## Run locally

```sh
pnpm install
pnpm dev
```

Run the production service after building it with `pnpm build && pnpm start`.
The service listens on port `3000` by default. Set `PORT` to change that port.

## Archive operations

`ENDURO_DB_PATH` selects the SQLite database file. It defaults to
`/data/enduro.db` in the production image. The production Compose service
mounts the `enduro-data` Docker volume at `/data`, so the database and its WAL
files survive container rebuilds and restarts.

The archive is cache-first:

- Opening an archived race reads its latest successful snapshot without
  contacting the timing provider.
- Adding a new supported race fetches and archives it synchronously.
- **Refresh race data** is the only v1 action that fetches an already archived
  source again. Each successful refresh creates an immutable snapshot; a
  failed refresh leaves the current snapshot in place.

Only canonical LiveLaps and Moto-Tally race URLs (or a numeric LiveLaps race
ID) are accepted. LiveLaps and Moto-Tally results remain separate archived
source races even when they describe the same physical event.

`ENDURO_TRUSTED_PROXY_IPS` is an optional comma-separated list of reverse
proxy IPs or CIDR ranges. In production it should include the Docker network
used by Traefik so request rate limits use the client IP safely. Do not trust
arbitrary forwarded headers from direct clients.

### Backup

Stop the service first so SQLite can checkpoint its WAL, then archive the
entire mounted data directory. From the infrastructure checkout, use the
actual Docker volume name shown by `docker volume ls` (Compose may prefix it,
for example `infra_enduro-data`):

```sh
docker compose stop enduro
ENDURO_VOLUME=infra_enduro-data
docker run --rm -v "$ENDURO_VOLUME:/data:ro" -v "$PWD:/backup" alpine \
  tar czf /backup/enduro-data-$(date +%F).tgz -C /data .
docker compose start enduro
```

Store the resulting archive outside the server. It includes the SQLite
database, its journal files, and the compressed raw source artifacts.

### Restore

Restore only while Enduro is stopped. The command below replaces the mounted
archive with a backup; retain a copy of the current backup before proceeding.

```sh
docker compose stop enduro
ENDURO_VOLUME=infra_enduro-data
docker run --rm -v "$ENDURO_VOLUME:/data" -v "$PWD:/backup:ro" alpine sh -c \
  'rm -rf /data/* /data/.[!.]* /data/..?*; tar xzf /backup/enduro-data-YYYY-MM-DD.tgz -C /data'
docker compose start enduro
```

Use the real backup filename. On startup, Enduro runs any pending SQLite
migrations before serving requests.
