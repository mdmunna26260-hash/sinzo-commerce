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
    // Category tree (PR #12 / 1a4cd22 added Category.parentId to the schema). Without this column
    // every query that touches Category fails (home, /products, nav…) → storefront error page.
    await db.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "parentId" INTEGER`).catch(e => console.log(`  col Category.parentId: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Category_parentId_idx" ON "Category"("parentId")`).catch(() => {});
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Category_parentId_fkey') THEN ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`).catch(() => {});
    // Combo offers (PR #15): quantity tiers on Product, cross-product bundles, per-order combo savings.
    // The PDP selects comboOffers/comboEligible and checkout reads ComboBundle, so a DB without
    // these breaks product pages AND order placement. Matches prisma/schema.prod.prisma.
    await db.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "comboOffers" TEXT`).catch(e => console.log(`  col Product.comboOffers: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "comboEligible" BOOLEAN NOT NULL DEFAULT false`).catch(e => console.log(`  col Product.comboEligible: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "comboDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0`).catch(e => console.log(`  col Order.comboDiscount: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ComboBundle" ("id" SERIAL NOT NULL, "title" TEXT NOT NULL, "price" DOUBLE PRECISION NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "position" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "ComboBundle_pkey" PRIMARY KEY ("id"))`).catch(e => console.log(`  table ComboBundle: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ComboBundleItem" ("id" SERIAL NOT NULL, "bundleId" INTEGER NOT NULL, "productId" INTEGER NOT NULL, CONSTRAINT "ComboBundleItem_pkey" PRIMARY KEY ("id"))`).catch(e => console.log(`  table ComboBundleItem: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ComboBundleItem_bundleId_productId_key" ON "ComboBundleItem"("bundleId", "productId")`).catch(() => {});
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboBundleItem_bundleId_fkey') THEN ALTER TABLE "ComboBundleItem" ADD CONSTRAINT "ComboBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ComboBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$`).catch(() => {});
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboBundleItem_productId_fkey') THEN ALTER TABLE "ComboBundleItem" ADD CONSTRAINT "ComboBundleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$`).catch(() => {});
    // Free-gift rule + Meta CAPI idempotency (PR #17): Order.giftDiscount / Order.capiPurchaseSentAt.
    // Admin dashboard/orders read full Order rows, so a DB without these columns breaks them.
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "giftDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0`).catch(e => console.log(`  col Order.giftDiscount: ${e.message?.slice(0,80)}`));
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "capiPurchaseSentAt" TIMESTAMP(3)`).catch(e => console.log(`  col Order.capiPurchaseSentAt: ${e.message?.slice(0,80)}`));
    console.log("ensure-db: all DDL done ✓");
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => { console.error("ensure-db error:", e.message); process.exit(0); });
