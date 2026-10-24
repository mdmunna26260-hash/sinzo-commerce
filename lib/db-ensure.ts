import { db } from "./db";

/* Safety-net DDL for tables added after the initial release.
   Dev SQLite gets them via `prisma db push`, but production databases
   (VPS PostgreSQL / Vercel) may not be migrated manually before deploy.
   These CREATE TABLE IF NOT EXISTS statements are idempotent and match the
   Prisma schema exactly, so push notifications work immediately after deploy.
   Runs at most once per server process. */
/* Cold-start cost: these ~40 idempotent ALTER/CREATE statements are serial DB round-trips.
   On a small VPS every container start (and every deploy) paid for all of them before the
   first page could render. In production the schema is expected to be migrated
   (`npm run db:push:prod` / `schema:sync`), so the DDL is skipped: SCHEMA_READY=1 is the
   default. Set SCHEMA_READY=0 to bring the old self-healing behaviour back. */
const SKIP_DDL = process.env.NODE_ENV === "production" && process.env.SCHEMA_READY !== "0";

/* The guard lives on globalThis as well, so a dev hot-reload (or a second module
   instance) cannot start the block a second time. */
const g = globalThis as unknown as { __szEnsure?: Promise<void> };
let done: Promise<void> | null = g.__szEnsure ?? null;

/* SQLite has no `ALTER TABLE .. ADD COLUMN IF NOT EXISTS`. The fallback DDL below
   therefore catches duplicate-column errors, but Prisma still logs every caught
   error before the promise reaches `.catch()` — one hot reload could print dozens
   of alarming false failures and make the first request noticeably slower. A
   schema created by `prisma db push` already contains this complete signature, so
   skip the legacy safety net altogether in that normal development path. */
async function sqliteSchemaIsCurrent(): Promise<boolean> {
  const requiredColumns: Record<string, string[]> = {
    Order: ["channel", "stockDeducted", "packedAt", "packedBy", "reviewRequestedAt"],
    OrderItem: ["stockDeductedQty", "variantId", "preorder", "preorderDate"],
    ProductVariant: ["image"],
    Subscriber: ["unsubscribed", "unsubscribedAt"],
    Campaign: ["cursorId"],
    AbandonedCheckout: ["email", "recoveryEmailedAt", "captureKeyHash", "captureRevision", "recoveryAttemptedAt", "recoveryClaimId", "recoveryError", "convertedOrderId"],
    Product: ["saleEnds", "colorGroupId", "colorName", "colorImage", "soldCount", "preorder", "preorderDate", "soldMode"],
    User: ["twoFactorSecret", "twoFactorEnabled", "sessionVersion", "recoveryCodes"],
    Customer: ["points", "referralCode", "referredBy", "referralRewardedAt", "waOptIn", "waOptInAt"],
  };
  const requiredObjects = [
    "ColorGroup", "PushSubscription", "Payment", "Waitlist", "InboxMessage", "AppLog", "WaDevice", "WaTemplate", "WaMessage", "WaBroadcast", "WaLink", "WaOptOut",
    "AbandonedCheckout_captureKeyHash_key", "AbandonedCheckout_checkoutStatus_recoveryAttemptedAt_updatedAt_idx", "Product_colorGroupId_idx",
    "PushSubscription_endpoint_key", "Customer_referralCode_key", "Payment_orderId_idx", "Waitlist_productId_idx", "InboxMessage_waId_createdAt_idx",
    "AppLog_kind_createdAt_idx", "AppLog_level_createdAt_idx", "WaDevice_sessionId_key", "WaTemplate_key_key", "WaMessage_dedupeKey_key",
    "WaMessage_status_nextAttemptAt_idx", "WaMessage_toWaId_idx", "WaMessage_orderId_idx", "WaBroadcast_status_scheduledAt_idx", "WaLink_slug_key", "WaOptOut_waId_key",
  ];
  try {
    for (const [table, required] of Object.entries(requiredColumns)) {
      const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
      const present = new Set(rows.map((row) => row.name));
      if (required.some((column) => !present.has(column))) return false;
    }
    const objects = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM sqlite_master WHERE type IN ('table','index')`);
    const present = new Set(objects.map((row) => row.name));
    return requiredObjects.every((name) => present.has(name));
  } catch {
    return false;
  }
}

export function ensureExtraTables(): Promise<void> {
  if (SKIP_DDL) return Promise.resolve();
  if (!done) {
    done = run().catch((e) => { done = null; g.__szEnsure = null; throw e; });
    g.__szEnsure = done;
  }
  return done;
}

async function run(): Promise<void> {
  const isPg = (process.env.DATABASE_URL || "").startsWith("postgres");
  if (!isPg && await sqliteSchemaIsCurrent()) return;
  // Order.channel (order isolation between VPS and Vercel deployments)
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'vps'`
      : `ALTER TABLE "Order" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'vps'`)
    .catch(() => {});
  // Order.stockDeducted (stock minus only on Steadfast "delivered"; idempotency guard)
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "stockDeducted" BOOLEAN NOT NULL DEFAULT false`
      : `ALTER TABLE "Order" ADD COLUMN "stockDeducted" BOOLEAN NOT NULL DEFAULT 0`)
    .catch(() => {});
  // Exact delivery deduction per line (shortfalls must never inflate a later return).
  await db.$executeRawUnsafe(isPg
    ? `ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stockDeductedQty" INTEGER`
    : `ALTER TABLE "OrderItem" ADD COLUMN "stockDeductedQty" INTEGER`).catch(() => {});
  // ProductVariant.image (linked color variants)
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "image" TEXT`
      : `ALTER TABLE "ProductVariant" ADD COLUMN "image" TEXT`)
    .catch(() => {});
  // Subscriber: one-click unsubscribe (newsletter campaigns)
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "unsubscribed" BOOLEAN NOT NULL DEFAULT false` : `ALTER TABLE "Subscriber" ADD COLUMN "unsubscribed" BOOLEAN NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMP(3)` : `ALTER TABLE "Subscriber" ADD COLUMN "unsubscribedAt" DATETIME`).catch(() => {});
  // Campaign: one newsletter send per row (subject/body + batch progress columns)
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "Campaign" ("id" SERIAL PRIMARY KEY, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "ctaLabel" TEXT, "ctaUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "total" INTEGER NOT NULL DEFAULT 0, "sent" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "cursorId" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3), "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    : `CREATE TABLE IF NOT EXISTS "Campaign" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "ctaLabel" TEXT, "ctaUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "total" INTEGER NOT NULL DEFAULT 0, "sent" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "cursorId" INTEGER NOT NULL DEFAULT 0, "sentAt" DATETIME, "createdBy" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    .catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "cursorId" INTEGER NOT NULL DEFAULT 0` : `ALTER TABLE "Campaign" ADD COLUMN "cursorId" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  // AbandonedCheckout: email + recovery tracking columns
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "email" TEXT` : `ALTER TABLE "AbandonedCheckout" ADD COLUMN "email" TEXT`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "recoveryEmailedAt" TIMESTAMP(3)` : `ALTER TABLE "AbandonedCheckout" ADD COLUMN "recoveryEmailedAt" DATETIME`).catch(() => {});
  // Durable capture identity, recovery attempt claims and conversion idempotency.
  for (const [column, pgType, sqliteType] of [
    ["captureKeyHash", "TEXT", "TEXT"], ["captureRevision", "INTEGER NOT NULL DEFAULT 0", "INTEGER NOT NULL DEFAULT 0"], ["recoveryAttemptedAt", "TIMESTAMP(3)", "DATETIME"],
    ["recoveryClaimId", "TEXT", "TEXT"], ["recoveryError", "TEXT", "TEXT"], ["convertedOrderId", "INTEGER", "INTEGER"],
  ]) await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN ${isPg ? "IF NOT EXISTS " : ""}"${column}" ${isPg ? pgType : sqliteType}`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCheckout_captureKeyHash_key" ON "AbandonedCheckout"("captureKeyHash")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AbandonedCheckout_checkoutStatus_recoveryAttemptedAt_updatedAt_idx" ON "AbandonedCheckout"("checkoutStatus", "recoveryAttemptedAt", "updatedAt")`);
  // Product.saleEnds (flash sale countdown)
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "saleEnds" TIMESTAMP(3)`
      : `ALTER TABLE "Product" ADD COLUMN "saleEnds" DATETIME`)
    .catch(() => {});
  // Color groups (linked color products) + Product color fields
  await db
    .$executeRawUnsafe(isPg
      ? `CREATE TABLE IF NOT EXISTS "ColorGroup" (
          "id" SERIAL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
      : `CREATE TABLE IF NOT EXISTS "ColorGroup" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "name" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`)
    .catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ColorGroup_name_key" ON "ColorGroup"("name")`).catch(() => {});
  const productCols: [string, string, string][] = [
    ["colorGroupId", isPg ? "INTEGER" : "INTEGER", ""],
    ["colorName", isPg ? "TEXT" : "TEXT", ""],
    ["colorImage", isPg ? "TEXT" : "TEXT", ""],
  ];
  for (const [col, type] of productCols) {
    await db
      .$executeRawUnsafe(isPg
        ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "${col}" ${type}`
        : `ALTER TABLE "Product" ADD COLUMN "${col}" ${type}`)
      .catch(() => {});
  }
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Product_colorGroupId_idx" ON "Product"("colorGroupId")`).catch(() => {});
  // Product.soldCount (optional "Sold: N" badge) — safe for existing tables
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "soldCount" INTEGER`
      : `ALTER TABLE "Product" ADD COLUMN "soldCount" INTEGER`)
    .catch(() => {});
  // OrderItem.variantId (variant-aware restock) — safe for existing tables
  await db
    .$executeRawUnsafe(isPg
      ? `ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantId" INTEGER`
      : `ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER`)
    .catch(() => {});
  if (isPg) {
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "PushSubscription" (
        "id" SERIAL PRIMARY KEY,
        "endpoint" TEXT NOT NULL,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "phone" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
  } else {
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "PushSubscription" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "endpoint" TEXT NOT NULL,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "phone" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
  }
  await db
    .$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`)
    .catch(() => {});

  // Product pre-order system
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "preorder" BOOLEAN NOT NULL DEFAULT FALSE` : `ALTER TABLE "Product" ADD COLUMN "preorder" BOOLEAN NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "preorderDate" TIMESTAMP(3)` : `ALTER TABLE "Product" ADD COLUMN "preorderDate" DATETIME`).catch(() => {});
  // Product.soldMode (fixed | random sold count)
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "soldMode" TEXT NOT NULL DEFAULT 'fixed'` : `ALTER TABLE "Product" ADD COLUMN "soldMode" TEXT NOT NULL DEFAULT 'fixed'`).catch(() => {});
  // OrderItem pre-order flag (expected date + no stock decrement for these lines)
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "preorder" BOOLEAN NOT NULL DEFAULT FALSE` : `ALTER TABLE "OrderItem" ADD COLUMN "preorder" BOOLEAN NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "preorderDate" TIMESTAMP(3)` : `ALTER TABLE "OrderItem" ADD COLUMN "preorderDate" DATETIME`).catch(() => {});
  /* ── items 6–16: payments, waitlist, WhatsApp inbox, log viewer, 2FA, loyalty ── */
  // Order packing + post-delivery review request
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3)` : `ALTER TABLE "Order" ADD COLUMN "packedAt" DATETIME`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packedBy" TEXT` : `ALTER TABLE "Order" ADD COLUMN "packedBy" TEXT`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3)` : `ALTER TABLE "Order" ADD COLUMN "reviewRequestedAt" DATETIME`).catch(() => {});
  // Admin 2FA (TOTP secret is written only after the first valid code) + logout-everywhere
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT` : `ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false` : `ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0` : `ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryCodes" TEXT` : `ALTER TABLE "User" ADD COLUMN "recoveryCodes" TEXT`).catch(() => {});
  // Customer loyalty points + referral code (unique — a friend entering it rewards both sides)
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0` : `ALTER TABLE "Customer" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralCode" TEXT` : `ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referredBy" INTEGER` : `ALTER TABLE "Customer" ADD COLUMN "referredBy" INTEGER`).catch(() => {});
  await db.$executeRawUnsafe(isPg ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralRewardedAt" TIMESTAMP(3)` : `ALTER TABLE "Customer" ADD COLUMN "referralRewardedAt" DATETIME`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Customer_referralCode_key" ON "Customer"("referralCode")`).catch(() => {});
  // Payment rows (advance / due / refund) — paid total is the sum of the rows, never a guess
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "Payment" ("id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "amount" DOUBLE PRECISION NOT NULL, "method" TEXT NOT NULL DEFAULT 'bkash', "kind" TEXT NOT NULL DEFAULT 'ADVANCE', "note" TEXT, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    : `CREATE TABLE IF NOT EXISTS "Payment" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "orderId" INTEGER NOT NULL, "amount" REAL NOT NULL, "method" TEXT NOT NULL DEFAULT 'bkash', "kind" TEXT NOT NULL DEFAULT 'ADVANCE', "note" TEXT, "createdBy" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Payment_orderId_idx" ON "Payment"("orderId")`).catch(() => {});
  // Waitlist for out-of-stock products
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "Waitlist" ("id" SERIAL PRIMARY KEY, "productId" INTEGER NOT NULL, "variantId" INTEGER, "contact" TEXT NOT NULL, "note" TEXT, "notifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    : `CREATE TABLE IF NOT EXISTS "Waitlist" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "productId" INTEGER NOT NULL, "variantId" INTEGER, "contact" TEXT NOT NULL, "note" TEXT, "notifiedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Waitlist_productId_idx" ON "Waitlist"("productId")`).catch(() => {});
  // WhatsApp inbox (bridge forwards inbound messages here)
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "InboxMessage" ("id" SERIAL PRIMARY KEY, "waId" TEXT NOT NULL, "name" TEXT, "direction" TEXT NOT NULL, "body" TEXT NOT NULL, "orderId" INTEGER, "status" TEXT NOT NULL DEFAULT 'ok', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    : `CREATE TABLE IF NOT EXISTS "InboxMessage" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "waId" TEXT NOT NULL, "name" TEXT, "direction" TEXT NOT NULL, "body" TEXT NOT NULL, "orderId" INTEGER, "status" TEXT NOT NULL DEFAULT 'ok', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InboxMessage_waId_createdAt_idx" ON "InboxMessage"("waId","createdAt")`).catch(() => {});
  // AppLog (client errors, webhooks, SMS, WhatsApp, mail, cron, backups) — the Logs screen
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "AppLog" ("id" SERIAL PRIMARY KEY, "level" TEXT NOT NULL DEFAULT 'INFO', "kind" TEXT NOT NULL, "message" TEXT NOT NULL, "meta" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    : `CREATE TABLE IF NOT EXISTS "AppLog" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "level" TEXT NOT NULL DEFAULT 'INFO', "kind" TEXT NOT NULL, "message" TEXT NOT NULL, "meta" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AppLog_kind_createdAt_idx" ON "AppLog"("kind","createdAt")`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AppLog_level_createdAt_idx" ON "AppLog"("level","createdAt")`).catch(() => {});

  /* ── WhatsApp broadcast & automation (Phase 1): devices, outbox queue, templates ── */
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaDevice" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "sessionId" TEXT NOT NULL,
        "phone" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
        "isDefault" BOOLEAN NOT NULL DEFAULT false,
        "dailyCap" INTEGER NOT NULL DEFAULT 50,
        "sentToday" INTEGER NOT NULL DEFAULT 0,
        "sentDate" TEXT,
        "warmupStage" INTEGER NOT NULL DEFAULT 0,
        "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
        "lastSeenAt" TIMESTAMP(3),
        "lastError" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS "WaDevice" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "sessionId" TEXT NOT NULL,
        "phone" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
        "isDefault" BOOLEAN NOT NULL DEFAULT 0,
        "dailyCap" INTEGER NOT NULL DEFAULT 50,
        "sentToday" INTEGER NOT NULL DEFAULT 0,
        "sentDate" TEXT,
        "warmupStage" INTEGER NOT NULL DEFAULT 0,
        "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
        "lastSeenAt" DATETIME,
        "lastError" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WaDevice_sessionId_key" ON "WaDevice"("sessionId")`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaTemplate" (
        "id" SERIAL PRIMARY KEY,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'UTILITY',
        "body" TEXT NOT NULL,
        "mediaMode" TEXT NOT NULL DEFAULT 'NONE',
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS "WaTemplate" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'UTILITY',
        "body" TEXT NOT NULL,
        "mediaMode" TEXT NOT NULL DEFAULT 'NONE',
        "enabled" BOOLEAN NOT NULL DEFAULT 1,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WaTemplate_key_key" ON "WaTemplate"("key")`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaMessage" (
        "id" SERIAL PRIMARY KEY,
        "deviceId" INTEGER,
        "toWaId" TEXT NOT NULL,
        "kind" TEXT NOT NULL DEFAULT 'AUTO',
        "templateKey" TEXT,
        "body" TEXT NOT NULL,
        "mediaJson" TEXT,
        "couponCode" TEXT,
        "orderId" INTEGER,
        "broadcastId" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "error" TEXT,
        "dedupeKey" TEXT,
        "bridgeId" TEXT,
        "nextAttemptAt" TIMESTAMP(3),
        "lockedAt" TIMESTAMP(3),
        "meta" TEXT,
        "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sentAt" TIMESTAMP(3),
        "deliveredAt" TIMESTAMP(3),
        "readAt" TIMESTAMP(3)
      )`
    : `CREATE TABLE IF NOT EXISTS "WaMessage" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "deviceId" INTEGER,
        "toWaId" TEXT NOT NULL,
        "kind" TEXT NOT NULL DEFAULT 'AUTO',
        "templateKey" TEXT,
        "body" TEXT NOT NULL,
        "mediaJson" TEXT,
        "couponCode" TEXT,
        "orderId" INTEGER,
        "broadcastId" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "error" TEXT,
        "dedupeKey" TEXT,
        "bridgeId" TEXT,
        "nextAttemptAt" DATETIME,
        "lockedAt" DATETIME,
        "meta" TEXT,
        "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sentAt" DATETIME,
        "deliveredAt" DATETIME,
        "readAt" DATETIME
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WaMessage_dedupeKey_key" ON "WaMessage"("dedupeKey")`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WaMessage_status_nextAttemptAt_idx" ON "WaMessage"("status","nextAttemptAt")`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WaMessage_toWaId_idx" ON "WaMessage"("toWaId")`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WaMessage_orderId_idx" ON "WaMessage"("orderId")`).catch(() => {});

  /* ── WhatsApp broadcast (Phase 3): campaigns, short links, opt-outs ── */
  await db.$executeRawUnsafe(isPg
    ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "waOptIn" BOOLEAN NOT NULL DEFAULT false`
    : `ALTER TABLE "Customer" ADD COLUMN "waOptIn" BOOLEAN NOT NULL DEFAULT 0`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "waOptInAt" TIMESTAMP(3)`
    : `ALTER TABLE "Customer" ADD COLUMN "waOptInAt" DATETIME`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaBroadcast" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "templateKey" TEXT,
        "images" TEXT,
        "productIds" TEXT,
        "couponCode" TEXT,
        "linkTarget" TEXT,
        "linkSlug" TEXT,
        "audienceRule" TEXT NOT NULL DEFAULT '{}',
        "deviceIds" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "scheduledAt" TIMESTAMP(3),
        "recipients" TEXT,
        "total" INTEGER NOT NULL DEFAULT 0,
        "sent" INTEGER NOT NULL DEFAULT 0,
        "failed" INTEGER NOT NULL DEFAULT 0,
        "skipped" INTEGER NOT NULL DEFAULT 0,
        "enqueued" INTEGER NOT NULL DEFAULT 0,
        "createdBy" TEXT,
        "lastError" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" TIMESTAMP(3),
        "finishedAt" TIMESTAMP(3)
      )`
    : `CREATE TABLE IF NOT EXISTS "WaBroadcast" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "templateKey" TEXT,
        "images" TEXT,
        "productIds" TEXT,
        "couponCode" TEXT,
        "linkTarget" TEXT,
        "linkSlug" TEXT,
        "audienceRule" TEXT NOT NULL DEFAULT '{}',
        "deviceIds" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "scheduledAt" DATETIME,
        "recipients" TEXT,
        "total" INTEGER NOT NULL DEFAULT 0,
        "sent" INTEGER NOT NULL DEFAULT 0,
        "failed" INTEGER NOT NULL DEFAULT 0,
        "skipped" INTEGER NOT NULL DEFAULT 0,
        "enqueued" INTEGER NOT NULL DEFAULT 0,
        "createdBy" TEXT,
        "lastError" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" DATETIME,
        "finishedAt" DATETIME
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WaBroadcast_status_scheduledAt_idx" ON "WaBroadcast"("status","scheduledAt")`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaLink" (
        "id" SERIAL PRIMARY KEY,
        "slug" TEXT NOT NULL,
        "target" TEXT NOT NULL,
        "label" TEXT,
        "broadcastId" INTEGER,
        "clicks" INTEGER NOT NULL DEFAULT 0,
        "lastClickAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS "WaLink" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "slug" TEXT NOT NULL,
        "target" TEXT NOT NULL,
        "label" TEXT,
        "broadcastId" INTEGER,
        "clicks" INTEGER NOT NULL DEFAULT 0,
        "lastClickAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WaLink_slug_key" ON "WaLink"("slug")`).catch(() => {});
  await db.$executeRawUnsafe(isPg
    ? `CREATE TABLE IF NOT EXISTS "WaOptOut" (
        "id" SERIAL PRIMARY KEY,
        "waId" TEXT NOT NULL,
        "reason" TEXT,
        "source" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS "WaOptOut" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "waId" TEXT NOT NULL,
        "reason" TEXT,
        "source" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).catch(() => {});
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WaOptOut_waId_key" ON "WaOptOut"("waId")`).catch(() => {});
}
