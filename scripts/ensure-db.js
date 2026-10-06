/* Additive PostgreSQL schema safety net.
   Runs on container start with the runtime DATABASE_URL, and after a direct
   npm build when DATABASE_URL is available. Idempotent. A reviewed production
   schema push is still required for full initialization/schema changes. */
const path = require("path");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) { console.log("ensure-db: no DATABASE_URL, skipping"); return; }
  const isPg = databaseUrl.startsWith("postgres");
  if (!isPg) { console.log("ensure-db: SQLite requires npm run db:push; no PostgreSQL DDL applied"); return; }

  console.log("ensure-db: running DDL for PostgreSQL...");
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    // ColorGroup table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ColorGroup" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ColorGroup_name_key" ON "ColorGroup"("name")`).catch(() => {});
    // Product columns
    for (const col of ["colorGroupId INTEGER", "colorName TEXT", "colorImage TEXT", "saleEnds TIMESTAMP(3)", "soldCount INTEGER"]) {
      const name = col.split(" ")[0];
      await db.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "${name}" ${col.split(" ").slice(1).join(" ")}`).catch(e => console.log(`  col ${name}: ${e.message?.slice(0,80)}`));
    }
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Product_colorGroupId_idx" ON "Product"("colorGroupId")`).catch(() => {});
    // ProductVariant.image
    await db.$executeRawUnsafe(`ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "image" TEXT`).catch(() => {});
    // OrderItem.variantId
    await db.$executeRawUnsafe(`ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantId" INTEGER`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stockDeductedQty" INTEGER`);
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "stockDeducted" BOOLEAN NOT NULL DEFAULT false`);
    // Order.channel
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'vps'`).catch(() => {});
    // Subscriber unsubscribe flags + Campaign table (newsletter send)
    await db.$executeRawUnsafe(`ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "unsubscribed" BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMP(3)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Campaign" ("id" SERIAL PRIMARY KEY, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "ctaLabel" TEXT, "ctaUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "total" INTEGER NOT NULL DEFAULT 0, "sent" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "cursorId" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3), "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "cursorId" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    // AbandonedCheckout.email + recoveryEmailedAt
    await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "email" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "recoveryEmailedAt" TIMESTAMP(3)`).catch(() => {});
    // Recovery capture ownership + durable dispatch/conversion guards.
    for (const [column, type] of [["captureKeyHash", "TEXT"], ["captureRevision", "INTEGER NOT NULL DEFAULT 0"], ["recoveryAttemptedAt", "TIMESTAMP(3)"], ["recoveryClaimId", "TEXT"], ["recoveryError", "TEXT"], ["convertedOrderId", "INTEGER"]]) {
      await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "${column}" ${type}`).catch(() => {});
    }
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCheckout_captureKeyHash_key" ON "AbandonedCheckout"("captureKeyHash")`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AbandonedCheckout_checkoutStatus_recoveryAttemptedAt_updatedAt_idx" ON "AbandonedCheckout"("checkoutStatus", "recoveryAttemptedAt", "updatedAt")`);
    // Review.photos
    await db.$executeRawUnsafe(`ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "photos" TEXT`).catch(() => {});
    // PushSubscription table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PushSubscription" ("id" SERIAL PRIMARY KEY, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL, "phone" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`).catch(() => {});
    // ── items 6–16 DDL (2FA, loyalty, payments, waitlist, inbox, logs) ──
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3)`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packedBy" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewRequestedAt" TIMESTAMP(3)`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryCodes" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralCode" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referredBy" INTEGER`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralRewardedAt" TIMESTAMP(3)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Customer_referralCode_key" ON "Customer"("referralCode")`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Payment" ("id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "amount" DOUBLE PRECISION NOT NULL, "method" TEXT NOT NULL DEFAULT 'bkash', "kind" TEXT NOT NULL DEFAULT 'ADVANCE', "note" TEXT, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Payment_orderId_idx" ON "Payment"("orderId")`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Waitlist" ("id" SERIAL PRIMARY KEY, "productId" INTEGER NOT NULL, "variantId" INTEGER, "contact" TEXT NOT NULL, "note" TEXT, "notifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Waitlist_productId_idx" ON "Waitlist"("productId")`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "InboxMessage" ("id" SERIAL PRIMARY KEY, "waId" TEXT NOT NULL, "name" TEXT, "direction" TEXT NOT NULL, "body" TEXT NOT NULL, "orderId" INTEGER, "status" TEXT NOT NULL DEFAULT 'ok', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AppLog" ("id" SERIAL PRIMARY KEY, "level" TEXT NOT NULL DEFAULT 'INFO', "kind" TEXT NOT NULL, "message" TEXT NOT NULL, "meta" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AppLog_kind_createdAt_idx" ON "AppLog"("kind","createdAt")`).catch(() => {});
    console.log("ensure-db: all DDL done ✓");
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => { console.error("ensure-db error:", e.message); process.exit(0); });
