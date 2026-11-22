# Code audit - 2026-11-01

Scope: repository checks plus focused review of authentication, admin orders, checkout validation, inventory, courier booking, payments and recovery. This is not a guarantee that every defect or security issue has been discovered.

## Fixes included

- Bulk courier requests release the shared UI mutation lock on network failure; simultaneous row actions cannot bypass it. Copying a phone number no longer clears an unrelated mutation's busy state.
- Print-label fields are HTML-escaped, and labels use the current merged order state rather than stale initial courier IDs.
- Manual and bulk courier bookings reject delivered/cancelled/returned orders before contacting the provider. Manual courier routes validate order IDs.
- Courier COD amounts exclude recorded advance/collected payments and collect zero for paid orders. Ambiguous legacy partial payments without ledger entries require review before booking. Refund-only legacy entries cannot increase collection above the order total.
- Courier status clients recognize application-level provider errors even when HTTP status is 200. Manual admin status lookup returns a non-success HTTP response on failure.
- Admin token helpers only attach session credentials to relative same-origin admin paths, replace existing query tokens safely and preserve URL fragments.
- An invalid primary admin cookie no longer shadows a valid fallback cookie; account activity/session-version checks remain mandatory.
- Local API test cleanup explicitly removes inventory/payment/item fixtures rather than relying on database cascades in adapter-only test setups.

The same changeset also includes the previously requested compact Orders UI, product thumbnails, WP/Call buttons, editable status-aware WhatsApp drafts and embedded-preview login fixes. No automatic courier sync, scheduling or background courier polling is included.

## Verification

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | Passed |
| Unit regressions | 188 passed, 0 failed |
| Touch source audit | 55 passed, 0 failed |
| Local HTTP/DB API regressions | 89 passed, 0 failed |
| Local recovery HTTP/DB/SMTP regressions | 53 passed |
| Optimized Next.js production compilation | Passed, including type validation and static generation |
| Chromium Orders UI | 320px/390px mobile, 1280px desktop, dark mode; no page overflow or browser runtime errors observed |
| `git diff --check` | Passed |

All mutating HTTP tests used isolated loopback PostgreSQL. Email tests used a loopback-only SMTP sink and synthetic recipients. Courier monetary logic was tested using mocked fetch; closed-order HTTP tests reject before provider access. No real courier bookings, WhatsApp sends or production mutations were made.

Environment qualifications: native Prisma engine downloads are blocked here. Production compilation used the already-generated PostgreSQL client and sandbox adapter preload (`next build`, not the complete `npm run build` Prisma-generation pipeline). An initial dev-server memory restart interrupted an earlier API run; rerunning with a larger heap completed. An initial recovery attempt correctly rejected a test cron secret shorter than 32 characters; a compliant local-only test value completed the suite. A later API run exposed orphan movements left by earlier local test cleanup; cleanup was corrected and local orphan fixtures removed, then all 89 checks passed.

## Remaining dependency security advisories - not fixed

`npm audit --omit=dev` reports **1 critical and 1 moderate vulnerable dependency** (package counts, not advisory counts):

- **Next.js 15.5.27 (critical):** registry recommends 15.5.29. Advisories include GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r, GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2 and GHSA-pc58-hwjq-p385. Built-in image optimization is currently disabled, which limits the relevance of the image-optimization advisories but does not establish safety from the other advisories.
- **Nodemailer 10.0.13 (moderate):** registry recommends 10.6.1; the reported address-parser advisories affect versions below 10.1.4 (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h).

Dependency upgrades require changing package.json and package-lock.json. Those files were deliberately left unchanged under the user's standing instruction. Approval to update them, followed by repeat build/API/recovery checks, is recommended before production rollout. Passing application tests does not resolve these advisories.

## Limits

No live Neon or deployed-host verification was possible from this environment. Provider delivery, network ambiguity after courier acceptance, and simultaneous booking from different devices are not established by the UI mutation lock or these tests. Existing invoice/provider duplicate-handling behavior was not exercised against a real courier. Production deployment and merging are separate from pushing this branch.
