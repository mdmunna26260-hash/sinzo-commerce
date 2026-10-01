# Abandoned checkout recovery

## Behavior

- A checkout draft is captured only after valid name, normalized BD phone and address exist. Updates are debounced; email, quantity, delivery zone, notes, gift wrap and applied coupon changes are included. Page exit uses a bounded beacon.
- Drafts belong to an unguessable browser key, not a phone lookup. Monotonic revisions discard late writes; completed drafts cannot be resurrected by an in-flight capture.
- Product/variant IDs and server-priced snapshots are stored. Recovery rechecks current catalogue, prices and aggregate stock. Explicit warnings accompany unavailable items or reduced quantities.
- Private, contact-bound signed links expire after seven days. The token is in a URL fragment (not HTTP/referrer query logs), removed from browser history, and excluded from tracking. The cart API accepts the bearer in a POST body and returns `private, no-store` responses.
- The link works in a fresh browser. Contact, zone, gift wrap and an eligible coupon are restored. An existing different cart is never silently overwritten: the customer chooses restore or keep.
- Customer checkout and admin conversion close the draft atomically. Conversion uses current prices, valid coupons and linked SKU/variant lines; retries do not create a second order. Inventory still deducts **at delivery**, not checkout.

## Production setup — required before enabling automation

1. Back up the database and review/apply `npm run db:push:prod` against the **runtime PostgreSQL URL**. This repo does not have migration history for `prisma migrate deploy`. New fields on `AbandonedCheckout` are `captureKeyHash`, `captureRevision`, `recoveryAttemptedAt`, `recoveryClaimId`, `recoveryError`, and `convertedOrderId`, plus capture identity/dispatch indexes. Runtime additive DDL is a safety net, not complete database initialization.
2. Keep a strong persistent `SESSION_SECRET` across workers and deployments; rotating it invalidates recovery links. Configure `seo.siteUrl` / `NEXT_PUBLIC_SITE_URL` to the correct public HTTPS origin.
3. Configure SMTP in **Settings → Notifications**, including a valid From address. Port 465 uses TLS. Check authentication and provider SPF/DKIM/delivery configuration; local tests cannot certify real inbox delivery.
4. Generate a separate runtime `CRON_SECRET`, e.g. `openssl rand -hex 32`. Never commit it, pass it as a build argument, or put it in a URL.
5. In **Marketing & Recovery**, save the optional recovery coupon and enable **automatic recovery**. Automation is **off by default**. The manual run button is permission-protected and deliberately confirmed.
6. Start `npm run recovery:worker` under a process manager on the VPS. It polls every five minutes without overlapping its own passes. `npm run recovery:run` performs one authenticated automatic pass.

The worker's default internal endpoint is `http://127.0.0.1:3000/api/admin/abandoned-recover` (server-to-server only). For the optional Docker Compose `recovery` profile, it uses `http://app:3000/...` instead. Runtime `CRON_SECRET` must match the app. This is not a browser-facing localhost API.

An existing cron system may POST to `/api/admin/abandoned-recover` with `Authorization: Bearer <CRON_SECRET>`. Authenticated GET is also supported for cron clients, but cookies and `?token=` do not authorize it. Do not expose the key in a URL/history/log. The optional compose worker is not started unless its profile is selected; follow your deployment's compose path/build context conventions.

## Send policy and failures

Eligible drafts are OPEN, inactive at least 45 minutes, contain an email and trusted version-2 SKU data, and have not already been attempted. A pass processes up to five rows. Database claims protect against concurrent workers, and normalized phone/email recipients have a 24-hour cooldown.

There is **one automatic SMTP attempt per draft**. SMTP/provider acceptance is recorded separately from actual inbox delivery. Exactly-once delivery across an external SMTP service cannot be guaranteed. Failed or ambiguous sends are not blindly retried: staff must check provider logs, explicitly confirm no delivery, then use **Review / retry reminder** and run a new pass. No-send claims caused by active checkout changes are released so the customer can become eligible again after inactivity.

Old title/price-only drafts are displayed but never guessed into products, auto-emailed or converted into unlinked inventory orders. Ask those customers to rebuild checkout. Historical orders/balances are not rewritten automatically.

## Verification

- `npm run check`: TypeScript + unit + touch checks; no running server required.
- With a seeded **isolated local SQLite app**, exported environment and local admin password: `AUDIT_ALLOW_MUTATIONS=1 npm run test:recovery`.
- Recovery integration tests use real HTTP/database transactions and a loopback SMTP server accepting only synthetic `.invalid` recipients. Fixtures/settings are cleaned/restored. **Never run mutation suites on a live store.**
- Actual Chromium recovery checks cover capture edits, fresh-browser restore, automatic coupon/totals, successful checkout, current-cart consent, same-page link navigation, expiry/error UI and token-safe tracking.

No real customer email or production deployment was performed during this implementation. Native PostgreSQL/Docker execution still requires staging verification.
