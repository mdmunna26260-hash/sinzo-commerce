# Audit docs — 2026-09-15

- `AUDIT-2026-09-15.md` — full findings (storefront search, category filters, order-tracking
  enumeration, caching, SEO/social, admin auth). §0 lists the claims that were **wrong** when
  judged from HTML alone and what the source actually showed — read that first.
- `AUDIT-2026-09-15-EVIDENCE.txt` — the raw command output every finding is based on.
- `../FIX-LOG.md` — what was changed, why, and how each fix was verified.

Ops follow-ups (not code): set `SESSION_SECRET`; keep the DB URL in Dokploy env, not in
`.github/workflows/docker-build.yml`; protect the Dokploy panel; redirect port 80 → https at nginx;
run `node scripts/fix-prod-catalog.js` (dry-run) then `--apply`.
