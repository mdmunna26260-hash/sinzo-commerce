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
}
