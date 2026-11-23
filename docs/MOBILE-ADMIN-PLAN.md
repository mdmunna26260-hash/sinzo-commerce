# Mobile admin workflow improvements

The owner manages the store from a phone. Work is intentionally staged so existing checkout, inventory and fulfillment flows remain intact.

## Stage 1 - Order Details (implemented on current branch)

- Customer, address, zone, order total and current status at the top.
- One-tap Call, WhatsApp draft, copy phone and copy address.
- Compact mobile item rows and labeled price/quantity inputs; desktop table retained.
- Documents/navigation and on-demand fraud tools collapsed by default.
- Mobile quick action bar above the existing glass navigation: save drafts, confirm a pending order, book a ready order, or manually check an existing consignment.
- Native unload and link-navigation warnings for unsaved customer/item/note edits. Browser-history navigation without unloading the document is not covered by this guard.
- Failed network saves preserve edits and release mutation locks; customer editor closes only after successful save. Saved state uses the API's actual order response.
- Status/payment changes require confirmation and cannot bypass unsaved edits. Courier actions remain manual; no polling or scheduler.
- Payment recording shares the fulfillment mutation lock, retains input after failure, and exposes payment-history errors instead of falsely showing no payments.
- Invalid order IDs and malformed legacy attribution JSON no longer crash the details page.

Validation: TypeScript, 207 unit tests, touch source audit 55/0, Chromium at 320/390/760/1280px, light/dark checks, failed-save retention, navigation cancellation, mobile item cards and fixed-bar positioning. These are local sandbox checks, not production or physical-device verification.

## Stage 2 - Dashboard (implemented on current branch)

- Work queues appear before sales reports: Pending orders, Ready to send, On hold and Stock attention.
- Ready means CONFIRMED/PROCESSING/PACKED without a courier consignment. Counts and linked order lists share the same predicate; no automatic booking or synchronization.
- Queue filtering runs in the database before the latest-200 limit, so older actionable orders are not hidden behind unrelated recent orders. Counts include all matches; the view limit is explicitly labeled. Switching away from a scoped queue reloads the appropriate list.
- Stock attention counts all ACTIVE products at or below their individual lowStock threshold, including a zero threshold; it is not derived from a six-row preview. The shortcut opens the matching active-product restock section.
- All orders, Add product and Update stock shortcuts use existing workflows. Add product opens the existing creation modal directly.
- Product/stock shortcuts and queries are permission-gated; customer totals are hidden without customer permission. Failed queue counts show an unknown state rather than a misleading zero.
- Existing reports and compact glass navigation retained. Preview tokens stay on local admin links and survive filters/hash anchors.

Validation: `npm run check` passed (215 unit tests, TypeScript, touch audit 55/0); `git diff --check` passed; package.json/package-lock.json unchanged. Real local Chromium/PostgreSQL checks passed at 320/390/760/1280px without horizontal overflow, plus light/dark review, custom stock thresholds with more than six matches, actionable orders older than 200 unrelated orders, queue-to-All navigation, creation-modal deep link, stock deep link and ORDER_MANAGER permission restrictions. Browser fixtures were cleaned up. Local sandbox verification only; real Neon/production and physical devices were not verified.

## Stage 3 - Product editor (implemented on current branch)

- Retained the existing product, duplicate and multi-photo APIs. New products start as DRAFT; required title/price are labeled and validated with the same parser as the server before requesting a save.
- Full-height mobile dialog with independently scrolling fields and persistent Draft/Publish controls. Offers/delivery/pre-order and linked-color/chart/badge options collapse without removing existing features. Scoped CSS overrides legacy storefront sheet styles; dark primary action contrast is explicitly preserved.
- Publishing and removing a live product from the storefront require confirmation. Failures preserve edits and keep feedback visible in the dialog. Shared synchronous mutation lock prevents repeated saves and overlapping photo/variant/chart/color-group operations.
- Upload batches keep each successful photo even if a later file fails. Failed filenames remain visible for selective retry; locks release after errors. Photo ordering and variant photo removal remain available.
- Duplication confirms zero-stock draft creation and immediately opens the returned copy for review. Existing duplicate API resets stock, variant stock and identifying fields; no duplicate API was added.
- Size presets append missing sizes with zero stock instead of replacing existing variants or inventing stock. Variant inputs have persistent labels. Bulk variant stock setting previews current quantities in a confirmation and applies only when the product is saved.
- Dirty close/backdrop/Escape and document-unload warnings; focus containment/restore and body-scroll lock. VisualViewport changes reserve space above a software keyboard, but physical-device keyboard behavior is not verified. Same-document browser-history navigation is not intercepted.
- Product search/list state stays mounted beneath the editor. Stock links using `?edit=id` now open the corresponding product. Existing barcode is loaded, editable and preserved rather than accidentally cleared on save.

Validation: `npm run check` passed (225 unit tests, TypeScript, touch audit 55/0), targeted editor tests 10/10, and `git diff --check` passed. Local Chromium/PostgreSQL checks passed at 320/390/760/1280px, including expanded-option horizontal-overflow checks, full-height mobile dialog/save-bar positioning, light/dark review, real draft/create/publish/duplicate APIs, original variant-ID/barcode preservation, safe size presets/bulk-stock confirmation, mocked partial-upload failure, failed-save retention, dirty-close cancellation and required-field focus. Fixtures were explicitly removed. Upload storage/provider and physical-device keyboards were not integration-tested; Neon/production remains unverified. Package manifests/lock unchanged; no commit/push/deployment.

## Stage 4 - Inventory (implemented on current branch)

- Reused the existing manual-stock endpoint and ledger; added optional variant and optimistic-preview identifiers without breaking existing product-only callers. No schema migration required.
- Search all non-archived products/variants by title, size/color, SKU or barcode. An alert filter starts enabled on the dashboard attention link. The view renders up to 40 matches plus the open draft; narrowing search accesses remaining matches. Product-level dashboard counts remain product counts, not variant-row counts.
- Explicit Add/subtract versus Set exact count, including zero; optional product unit cost stays blank by default so ordinary restocks do not accidentally change cost.
- Inline before/after preview and explicit confirmation show the selected count, product-total effect and any unit-cost change. Variant updates apply the same delta to product stock, matching the existing delivery policy; product-only adjustments do not recompute variant quantities.
- Product write lock, variant ownership checks, underflow/overflow checks and optional expected counts guard the transaction. Stale previews return 409 without count/ledger changes; the client refreshes counts while preserving inputs for a new review. Variant ledger references identify the affected variant.
- Shared synchronous UI lock blocks repeated requests and selection changes. Failure preserves quantity/cost/note and warns that an uncertain save must be checked before retrying. Successful counts update immediately. Selection changes, document unload and link navigation warn about unsaved adjustments; same-document browser-history navigation is not intercepted.
- Stock-value report collapses to keep editing prominent. Existing KPIs/ledger remain; ledger date filters are applied before its 120-row limit. Existing post-restock waitlist behavior is retained, not newly enabled.

## Stage 5 - Settings (implemented on current branch)

- Existing settings groups and one-group-at-a-time API retained. Mobile section selector, per-group dirty indicators and current-section save bar above the glass navigation; desktop section tabs retained.
- Drafts stay in parent state across section switches, including homepage layout order/visibility. Saving one group leaves other groups' drafts and dirty markers untouched. Shared homepage content appears in both relevant section save controls.
- Lifted field/image components out of the parent render function so typing no longer remounts those inputs and loses focus.
- Per-group persistent saving/success/failure feedback; failed requests retain edits and release the lock. API now returns only the saved group's canonical masked value, allowing normalized numbers/hero data to become the clean baseline without replacing unrelated drafts or revealing known masked credentials.
- Settings saves, uploads and blacklist mutations have shared synchronous locks and failure handling. Shipping/checkout/maintenance/courier/fraud changes and blacklist operations require explicit live-store confirmation.
- Unload/link-navigation warnings protect drafts. VisualViewport positioning reserves mobile keyboard space for the save bar; physical-device keyboard behavior and same-document history guards remain limitations.
- Existing manual provider tests now release their busy state on network failure; SMS tests require confirmation and warn about charges. Tests clearly use saved settings. No provider test, real message or courier booking was performed during verification; no automatic courier synchronization was added.

Final validation for stages 4/5: `npm run check` passed (243 unit tests, TypeScript, touch source audit 55/0), `git diff --check` passed, and existing real HTTP/PostgreSQL API regressions passed 89/0. Chromium checks passed at 320/390/760/1280px with no horizontal overflow across Inventory and all nine Settings sections; light/dark review, before/after confirmation cancellation, real variant Add/Set/zero operations, product-total/ledger verification, competing identical-preview requests (one 200, one 409), stale-preview draft retention, failed-save retention, typing focus, cross-section/layout draft retention and section-only save behavior all passed. Temporary fixtures/configuration were restored. Adapter-assisted `NEXT_DIST_DIR=.next-prod ... npx next build` passed; standard `npm run build` (including native Prisma regeneration) was not run because sandbox engine downloads are restricted. Package manifests/lock unchanged. Local sandbox checks only: real Neon, production deployment and physical devices remain unverified.

## Stage status

All five planned mobile-admin stages are implemented on the current branch. No commit, push or deployment has been performed for this workflow series. Previously documented dependency advisories remain unresolved under the standing package/lock constraint; successful checks/build do not imply a clean dependency audit.

Standing decisions: preserve the compact horizontal glass navigation (including Website Home), use existing safe APIs, do not add automatic courier synchronization, and do not alter package.json/package-lock.json without approval. Previous Orders-list and customer Thank You redesigns on this same branch remain included and uncommitted.

### Sandbox preview follow-up

The storefront fallback was traced to three local `CollectionProduct` links pointing at deleted temporary products. The sandbox DDL helper does not generate Prisma relation foreign keys, unlike the production schema's `onDelete: Cascade`. Removed only orphan links, enabled a local collection/product cascade constraint, and extended API-regression cleanup to explicitly remove collection links/images/variants before fixture products. Sandbox-only browser cleanup scripts received the same collection-link cleanup. HTTP storefront content and Chromium mobile/desktop reloads passed without the fallback or browser page errors. This was a local test-data problem; it does not verify Neon/production state.

### Order-card mini note

Added a compact two-line internal `adminNote` preview with inline Add/Edit, 2,000-character editor, Save/Cancel, shared order mutation lock and retained drafts on failure. Uses the existing note-only order PUT; customer notes, WhatsApp drafts and courier payloads are unchanged. Dirty editor close/link/unload warnings are included; same-document history remains outside the guard. Validation: 246 unit tests, TypeScript, touch audit 55/0, Chromium 320/390/760px overflow checks, real note persistence/reload and failed-save retention. Browser checks restored the demo order's original note afterward.
