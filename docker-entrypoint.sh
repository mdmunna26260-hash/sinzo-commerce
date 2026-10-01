#!/bin/sh
# SINZO container entrypoint.
#
# It exists for one reason: to give the box a place to run one-shot maintenance BEFORE the app binds :3000,
# without needing SSH, a host shell, or a `docker exec`. Dokploy's panel can set environment variables and
# click Deploy — that is the whole interface a non-terminal user has.
#
#   MIGRATE_ON_BOOT=full   copy Neon → the VPS database while the shop still runs on Neon (see prisma/migrate-from-neon.js)
#   MIGRATE_ON_BOOT=final  last delta, during the deploy that already points DATABASE_URL at the VPS database
#
# Everything here is deliberately best-effort: a failing maintenance step must never keep the shop down.
# With MIGRATE_ON_BOOT unset (the normal case) this is exactly what the old CMD did, plus `exec` so the app
# receives SIGTERM properly instead of leaving `npm` as PID 1.

set -u

MIGRATE_MARKER="${MIGRATE_MARKER:-/tmp/sinzo-cutover.url}"

if [ -n "${MIGRATE_ON_BOOT:-}" ] && [ "$MIGRATE_ON_BOOT" != "0" ] && [ "$MIGRATE_ON_BOOT" != "off" ]; then
  echo "[boot] MIGRATE_ON_BOOT=$MIGRATE_ON_BOOT — running prisma/migrate-from-neon.js before the app starts"
  node prisma/migrate-from-neon.js || echo "[boot] migration exited non-zero (see the log above) — starting the app anyway"
  echo "[boot] migration phase finished"
fi

# A successful MIGRATE_ON_BOOT=cutover leaves this file behind. It is what the app boots on from now on, so
# the panel edit can happen later without the shop ever coming up on the old database in between.
if [ -s "$MIGRATE_MARKER" ]; then
  NEW_URL=$(cat "$MIGRATE_MARKER")
  case "$NEW_URL" in
    postgres*)
      [ "$NEW_URL" != "${DATABASE_URL:-}" ] && echo "[boot] DATABASE_URL switched for this process (cutover marker: $MIGRATE_MARKER)"
      export DATABASE_URL="$NEW_URL" ;;
    *) echo "[boot] ignoring malformed $MIGRATE_MARKER" ;;
  esac
fi

# Make sure newly added columns exist against the runtime database before serving requests.
[ -f scripts/ensure-db.js ] && node scripts/ensure-db.js

exec "$@"
