# Moving the database from Neon to the VPS

Short version: **dump Neon → restore into a *fresh empty database on the VPS Postgres* → verify → flip
`DATABASE_URL` → keep Neon paused as the rollback.** The tool for all of it is
[`neon-to-vps.sh`](./neon-to-vps.sh); this file is the part the script cannot do for you (cloud
consoles, DNS, webhooks) plus the traps.

---

## 0. Before you start

| Need | Why |
|---|---|
| Neon **direct** (non-pooled) URL | `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`. The `-pooler` host works for queries but is hostile to `pg_dump`. The PostgREST URL from the audit **cannot** copy data — it needs a JWT and serves rows, not a dump. |
| VPS shell or Dokploy → app → Console | the restore runs on the box |
| ~2× DB size free disk | dump + restored copy coexist. `precheck` prints the size; check `df -h`. |
| 2–5 min window with the app stopped | only for the final `catchup`; everything else happens with the store live |
| A generated `POSTGRES_PASSWORD` (not a reused one) | the VPS `db` service auth |

Nothing in `neon-to-vps.sh` ever writes to `SRC_URL`. Neon stays exactly as it was — that *is* the rollback.

## 1. What is actually in there (read from this repo, not guessed)

- 24 base tables, 21 of them with sequences (`prisma/schema.prod.prisma`).
- **Uploaded images live in the database** — `Media.data bytea` (+ `variantsJson`, `blurData`), served by
  `app/api/media/[id]/route.ts`. So the dump carries your pictures; there is nothing to `rsync`.
  `/uploads/seed/*` (demo shots) is in git. This also means the dump is *bigger than the row counts
  suggest* — `precheck` shows the `Media` byte total separately.
- Money-critical: `Order`, `OrderItem`, `Product`, `ProductVariant` (stock), `Coupon`, `Customer`,
  `AbandonedCheckout`.
- Optional shrink: `SKIP_TABLES='TrackingEvent AuditLog'` keeps those tables' structure but not their rows.
- Login rate limiters are in-process memory (`lib/auth.ts`), so they reset on restart either way — no data to move.
- The prod datasource has **no `directUrl`**, which means `prisma migrate`/`db push` go through whatever
  `DATABASE_URL` is set to. Fine for a pooled app; on a self-hosted box you can point it straight at Postgres.

## 2. Two decisions you have to make first

**(a) What happens to the Vercel deployment?**
Your VPS Postgres is not reachable from Vercel unless you publish 5432 to the internet, which you should not do.

| Option | Notes |
|---|---|
| **Retire the Vercel app** (recommended) | DNS `sinzooffcial.com` → VPS. Kills the split-brain the `Order.channel` column exists to work around, and you stop paying for two runtimes. |
| Keep Vercel for static/marketing only | Remove `DATABASE_URL` there and make `/api/*` fail loudly, otherwise it silently half-works. |
| Keep both, both on the VPS DB | Needs `sslmode=require` + a real cert + IP allowlist, and every query pays a WAN round-trip. Not recommended. |

**(b) Is the VPS `db` service already holding real data?**
`deploy/docker-compose.vps.yml` defines its own `sinzo` database. If orders were placed through the VPS
deployment, those rows are real. `precheck` prints the target's `Order` count. The script **refuses** to
restore into a non-empty database — that refusal is the feature. Two honest paths:

1. restore into a **new** database (`sinzo_live`), verify, flip — then deal with the old one; or
2. if the VPS-side orders matter, keep them: `FORCE_RESTORE` is *not* the answer; merge is (re-insert with
   new ids, or archive the old DB and relabel `channel`). Ask and I'll write the merge.

## 3. The run

```bash
cd /path/to/sinzo-commerce                      # wherever the repo is checked out on the VPS
docker compose -f deploy/docker-compose.vps.yml up -d db          # app stays LIVE for now
docker compose -f deploy/docker-compose.vps.yml exec -T db \
  psql -U sinzo -d postgres -c 'CREATE DATABASE sinzo_live OWNER sinzo;'

export SRC_URL='postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
export DST_URL='postgresql://sinzo:THE_POSTGRES_PASSWORD@127.0.0.1:5432/sinzo_live'
export RUNNER=container                           # psql/pg_dump come from the postgres:16 image
export CATCHUP_TABLES='Order OrderItem Product ProductVariant Customer Coupon Review InventoryMovement AbandonedCheckout PushSubscription'

./deploy/neon-to-vps.sh precheck                  # sizes, image bytes, what already exists
./deploy/neon-to-vps.sh plan                      # every command it would run — read it once
./deploy/neon-to-vps.sh dump                      # store live throughout
./deploy/neon-to-vps.sh restore
./deploy/neon-to-vps.sh verify                    # must end with "verify clean"
```

`RUNNER=container` still reaches the DB through `127.0.0.1` **inside** the container; if you would rather
use the host, add a temporary `ports: ["127.0.0.1:5432:5432"]` to the `db` service and `export RUNNER=host`.

### Cutover (the only window that needs the app down)

```bash
docker compose -f deploy/docker-compose.vps.yml stop app          # or Dokploy → Stop
./deploy/neon-to-vps.sh catchup      # orders that arrived during the restore; also fixes sequences
./deploy/neon-to-vps.sh verify       # clean again
```
Then in Dokploy → your service → Environment:
```
DATABASE_URL = postgresql://sinzo:THE_POSTGRES_PASSWORD@db:5432/sinzo_live
DEPLOY_CHANNEL = vps
```
Restart the service (`DATABASE_URL` is server-side, so a restart is enough — no rebuild needed) and:
```bash
docker compose -f deploy/docker-compose.vps.yml up -d app
./deploy/neon-to-vps.sh verify    # optional: same numbers, now against the live target
```

### Proof it actually works — do these three, in order

```bash
curl -s https://sinzooffcial.com/api/health
docker compose -f deploy/docker-compose.vps.yml exec -T app node scripts/verify-db-migration.js
```
and then **place a real ৳1 test order and cancel it**, because an out-of-sync sequence does not show up in
any count — it shows up as a 500 at checkout:
```bash
docker compose -f deploy/docker-compose.vps.yml exec -T db \
  psql -U sinzo -d sinzo_live -c 'select id,code,"createdAt" from "Order" order by id desc limit 3;'
```
`id` must be the old max **+1**, not a number that already existed.

## 4. Things that bite afterwards

- **Sequences.** A full `pg_dump -Fc` restore embeds `setval`, so it is already right after `restore`
  (measured: `last_value = max(id) = 41`). A `--data-only` reload — i.e. `catchup` — does **not**, which is
  why `catchup` runs the `sequences` pass automatically. Skip it and the first customer order fails with
  Prisma `P2002`.
- **Steadfast callbacks** (courier status webhooks) and any integration pointed at the old host — update in
  the courier dashboard, or tracking stops updating while the store seems fine.
- **Meta CAPI**: server-side events fire from whichever instance handles checkout. If you retire Vercel, the
  events it was sending stop; confirm Events Manager still shows test events 5–10 min after cutover.
- **`NEXT_PUBLIC_SITE_URL`** must be the final public URL in the surviving deployment, or canonical/OG/social
  previews keep naming the retired host. (It is a build-time var on Vercel → rebuild there if you keep it.)
- **`Order.channel`** (`lib/deploy-channel.ts`): with one deployment the admin "own channel" filter
  (`app/api/admin/orders/route.ts`) only shows that channel's history. To unify past orders:
  `UPDATE "Order" SET channel='vps' WHERE channel='vercel';` — count first, then update in the same session.
- **Backups are now your job.** Neon's snapshots/pit branched stop protecting you. Put the cron in the day you
  cut over, not "later":
  ```
  15 3 * * * cd /path/to/sinzo-commerce && docker compose -f deploy/docker-compose.vps.yml exec -T db \
    pg_dump -U sinzo -Fc sinzo_live | gzip > /var/backups/sinzo/sinzo-$(date +\%F).dump \
    && find /var/backups/sinzo -mtime +14 -delete
  ```
  and copy at least one dump per week **off the box** — a VPS provider's snapshot is not a backup.
- **`uploads` volume**: seed images are in git, DB media moves with the dump — but if anything ever wrote
  files under `public/uploads` outside `/seed`, copy the volume before you destroy the old container:
  `docker run --rm -v <project>_uploads:/from alpine cp -a /from /to` style, or `docker cp`.
- **Rotation still owed from the audit**: the Neon `service_role` JWT, the GitHub PAT and the admin/VPS
  passwords that were pasted into a chat. The admin password itself travels *with* the database, so no reset
  is needed to log in after the move — rotate it because it leaked, using
  `docker compose exec app node scripts/set-admin-password.js '<new>'`.
- **Pause, don't delete, Neon** for 7–14 days. `pg_dump` of the source again costs nothing while it exists;
  an unrecoverable mistake costs the store.

## 5. Rollback

1. Dokploy: set `DATABASE_URL` back to the Neon string, restart. Done — Neon was never written to.
2. If the app already wrote orders to the VPS database during the trial, move them back **before** flipping:
   run the same `catchup` with `SRC_URL`/`DST_URL` swapped (the script only reads `SRC_URL`), then flip.

## 6. Where these numbers came from

Everything above was exercised in a sandbox: Postgres 17, your real `prisma/schema.prod.prisma`, seed data
plus 41 orders and 3 `Media` rows holding 469 kB of image bytes.

- `precheck → dump → restore → verify`: 24/24 tables equal, `sum(total)=51570` equal, sequences already
  correct after the full restore.
- Deleted one `OrderItem` on the target → `verify` flagged `42 vs 41` and exited 1.
- `catchup` data-only reload with 5 new source orders → money/id/freshness all flagged before the fix, and the
  app's own `order.create` failed with `P2002`; after the `sequences` pass the same insert returned `id=47`.
- `scripts/verify-db-migration.js` — exit 0 when aligned, exit 1 on drift, `--json` emits pure JSON for CI.
- Bugs found and fixed while testing it: `pg_dump --truncate` does not exist in PG ≤ 17 (so truncate is
  explicit + an FK-closure expansion), a single-quoted SQL template that swallowed its own quotes, `sql()`
  leaking its banner into captured values, `nextval()` in the verify step burning an id per run,
  `sequences` demanding `SRC_URL` it does not need, and `--json` skipping the exit code.
