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
    /* TASK 01 performance indexes (listing filters/sorts + search).
       Prisma's db push creates these on fresh databases; these IF NOT EXISTS
       statements add them to the already-running production database. */
    const idx: [string, string][] = [
      ["Product_status_position_id_idx", `CREATE INDEX IF NOT EXISTS "Product_status_position_id_idx" ON "Product"("status","position","id")`],
      ["Product_status_price_idx", `CREATE INDEX IF NOT EXISTS "Product_status_price_idx" ON "Product"("status","price")`],
      ["Product_status_views_idx", `CREATE INDEX IF NOT EXISTS "Product_status_views_idx" ON "Product"("status","views")`],
      ["Product_status_createdAt_idx", `CREATE INDEX IF NOT EXISTS "Product_status_createdAt_idx" ON "Product"("status","createdAt")`],
      ["Product_status_categoryId_idx", `CREATE INDEX IF NOT EXISTS "Product_status_categoryId_idx" ON "Product"("status","categoryId")`],
      ["ProductVariant_productId_idx", `CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId")`],
      ["ProductVariant_size_stock_idx", `CREATE INDEX IF NOT EXISTS "ProductVariant_size_stock_idx" ON "ProductVariant"("size","stock")`],
      ["ProductImage_productId_idx", `CREATE INDEX IF NOT EXISTS "ProductImage_productId_idx" ON "ProductImage"("productId")`],
    ];
    for (const [, sql] of idx) await db.$executeRawUnsafe(sql).catch(() => {});
    /* trigram indexes: make LIKE '%q%' search (title/tags/sku/shortDesc/description)
       index-assisted instead of a sequential scan. One-time extension create. */
    await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
    for (const col of ["title", "tags", "sku", "shortDesc", "description"]) {
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Product_${col}_trgm_idx" ON "Product" USING gin ("${col}" gin_trgm_ops)`
      ).catch(() => {});
    }
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
}
