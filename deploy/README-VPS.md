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
   - SESSION_SECRET=(long random string)
   - SITE_URL=https://sinzooffcial.com
   - (+ all integrations: STEADFAST_*, META_*, SMTP/Gmail, GOOGLE_CLIENT_*)
4. Domain: sinzooffcial.com → port 3000 → HTTPS (Let's Encrypt auto)
5. Database: `npx prisma migrate deploy` (first run) — or Dokploy terminal:
   `cd /app && npx prisma migrate deploy`
6. Health check hits /api/health (endpoint already exists)

## Rollback
Dokploy → Deployments → previous version → Redeploy (or image rollback).
