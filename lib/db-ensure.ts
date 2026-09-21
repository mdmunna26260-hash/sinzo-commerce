import { db } from "./db";

/* Safety-net DDL for tables added after the initial release.
   Dev SQLite gets them via `prisma db push`, but production databases
   (VPS PostgreSQL / Vercel) may not be migrated manually before deploy.
   These CREATE TABLE IF NOT EXISTS statements are idempotent and match the
   Prisma schema exactly, so push notifications work immediately after deploy.
   Runs at most once per server process. */
let done: Promise<void> | null = null;

export function ensureExtraTables(): Promise<void> {
  if (!done) {
    done = run().catch((e) => { done = null; throw e; });
  }
  return done;
}

async function run(): Promise<void> {
  const isPg = (process.env.DATABASE_URL || "").startsWith("postgres");
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
}
