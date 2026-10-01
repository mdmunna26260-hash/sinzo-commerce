# SINZO VPS Deploy Guide (Dokploy + 2GB RAM)

## One-time server prep (SSH or Dokploy terminal, as root)
```bash
bash deploy/setup-swap.sh      # 2GB swap → traffic spikes won't crash the box
```

## Memory budget (2GB VPS)
| Component | Limit | Notes |
|---|---|---|
| OS + Dokploy + Traefik | ~350MB | always on |
| Postgres | ≤512MB | tuned flags (shared_buffers=128MB) |
| Next.js app | ≤896MB | NODE_OPTIONS cap |
| **Swap** | +2GB | absorbs spikes, no crash |
| **Free headroom** | ~250MB+ | safe margin |

## Deploy (Dokploy)
1. Project → new Application → GitHub → mdmunna26260-hash/sinzo-commerce (main)
2. Build type: Dockerfile (repo root)
3. Environment:
   - POSTGRES_PASSWORD=(strong password)
   - DATABASE_URL=postgresql://sinzo:(password)@db:5432/sinzo (use your database host)
   - SESSION_SECRET=(long random string)
   - SITE_URL=https://sinzooffcial.com
   - (+ all integrations: STEADFAST_*, META_*, SMTP/Gmail, GOOGLE_CLIENT_*)
4. Domain: sinzooffcial.com → port 3000 → HTTPS (Let's Encrypt auto)
5. Database: this repository ships schemas, not a `prisma/migrations` history.
   Before initial launch or an upgrade, back up the database, review schema changes, and run:
   `cd /app && npx prisma db push --schema prisma/schema.prod.prisma`.
   Do not add `--accept-data-loss` blindly. Seed only an initial/demo database with
   `npm run db:seed:prod`; an upgrade must not overwrite existing data.
6. Health check hits /api/health (endpoint already exists)

## Rollback
Dokploy → Deployments → previous version → Redeploy (or image rollback).

## Database: Neon → VPS (self-hosted Postgres)

The compose stack above already runs `postgres:16-alpine` as the `db` service, so the data can live on the
box instead of Neon. Do not "just change the URL" — the sequence fix, the FK-closure reload and the
verify-before-cutover steps are the difference between a migration and a corrupted shop.

- Runbook (decisions, commands, rollback, what breaks afterwards): **[`NEON-TO-VPS.md`](./NEON-TO-VPS.md)**
- Tool: `deploy/neon-to-vps.sh` — `precheck | plan | dump | restore | catchup | sequences | verify | all`
- Post-copy integrity check (also good as a Monday-morning check): `npm run db:verify`

One-line shape of it, so the order of operations is obvious:

```bash
docker compose up -d db
docker compose exec -T db psql -U sinzo -d postgres -c 'CREATE DATABASE sinzo_live OWNER sinzo;'
SRC_URL='<neon direct url>' DST_URL='postgresql://sinzo:<pw>@127.0.0.1:5432/sinzo_live' \
  RUNNER=container ./deploy/neon-to-vps.sh all
# store live until here → then: stop app → catchup → verify → flip DATABASE_URL in Dokploy → start
```

## Release 2026-10-01

- `OrderItem.stockDeductedQty` is a new nullable integer used by delivery/return stock tracking.
  Apply the production schema before rollout; the container entrypoint also runs additive DDL
  against its runtime database. This safety net is not a substitute for a reviewed schema upgrade.
- Docker/CI builds no longer need production `DATABASE_URL`. Configure it **at runtime**;
  never put secrets into Docker build args. `.dockerignore` excludes local DB/env/session files.
- Rotate the database credential previously committed to the workflow (history still contains it).
  Set a persistent, random `SESSION_SECRET`; a missing/placeholder value produces an ephemeral
  process key and is not suitable for production workers/restarts.
- Back up before applying schema changes. Runtime PostgreSQL/Docker verification is still
  required in staging; the audit exercised real isolated SQLite rather than the live database.
