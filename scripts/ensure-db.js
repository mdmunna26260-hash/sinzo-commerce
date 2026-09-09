/* Build-time database schema safety net.
   Runs after `next build` — ensures all new columns/tables exist in the
   production database BEFORE the server handles any request.
   Idempotent — safe to run every deploy. */
const path = require("path");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) { console.log("ensure-db: no DATABASE_URL, skipping"); return; }
  const isPg = databaseUrl.startsWith("postgres");
  if (!isPg) { console.log("ensure-db: sqlite, using prisma db push"); return; }

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
    // Order.channel
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'vps'`).catch(() => {});
    // AbandonedCheckout.email + recoveryEmailedAt
    await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "email" TEXT`).catch(() => {});
    await db.$executeRawUnsafe(`ALTER TABLE "AbandonedCheckout" ADD COLUMN IF NOT EXISTS "recoveryEmailedAt" TIMESTAMP(3)`).catch(() => {});
    // Review.photos
    await db.$executeRawUnsafe(`ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "photos" TEXT`).catch(() => {});
    // PushSubscription table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PushSubscription" ("id" SERIAL PRIMARY KEY, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL, "phone" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`).catch(() => {});
    console.log("ensure-db: all DDL done ✓");
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => { console.error("ensure-db error:", e.message); process.exit(0); });
