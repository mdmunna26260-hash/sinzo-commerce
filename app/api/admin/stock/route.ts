import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { parseStockAdjustment, adjustedStock, StockAdjustmentError } from "@/lib/stock-adjustment";

export const dynamic = "force-dynamic";

/* Hand-written restocks/corrections share the same inventory as delivery.
   The product write lock must be acquired BEFORE reading/computing its count;
   otherwise concurrent restocks (or a delivery) are overwritten by stale data. */
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const productId = Number(url.searchParams.get("product") || 0);
  if (!Number.isSafeInteger(productId) || productId < 0 || productId > 2_147_483_647) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  const requestedTake = Number(url.searchParams.get("take") || 50);
  const take = Number.isFinite(requestedTake) ? Math.max(1, Math.min(200, Math.trunc(requestedTake))) : 50;
  const rows = await db.inventoryMovement.findMany({
    where: productId ? { productId } : {},
    orderBy: { id: "desc" }, take,
    include: { product: { select: { title: true, sku: true } } },
  });
  return NextResponse.json({ movements: rows });
}

export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const { productId, qty, mode, unitCost, note } = parseStockAdjustment(await req.json().catch(() => null));
    const result = await db.$transaction(async (tx) => {
      // Portable row write lock: PostgreSQL serializes on this product; SQLite
      // serializes writers. Read the current stock only after obtaining the lock.
      const locked = await tx.product.updateMany({ where: { id: productId }, data: { stock: { increment: 0 } } });
      if (!locked.count) throw new StockAdjustmentError("Product not found", 404);
      const before = await tx.product.findUnique({ where: { id: productId }, select: { title: true, stock: true } });
      if (!before) throw new StockAdjustmentError("Product not found", 404);
      const stock = adjustedStock(before.stock, mode, qty);
      await tx.product.update({ where: { id: productId }, data: { stock, ...(unitCost !== null ? { cost: unitCost } : {}) } });
      await tx.inventoryMovement.create({ data: { productId, delta: stock - before.stock, reason: mode === "set" ? "ADJUST" : qty > 0 ? "RESTOCK" : "MANUAL", ref: note || g.user.email } });
      return { before, stock, delta: stock - before.stock };
    }, { maxWait: 10_000, timeout: 20_000 });

    await logAudit(g.user.email, mode === "set" ? "STOCK_SET" : "STOCK_RESTOCK", `${result.before.title}: ${result.before.stock} → ${result.stock}${unitCost !== null ? ` @ ৳${unitCost}` : ""}${note ? " · " + note : ""}`);
    // Notifications are post-commit: provider/configuration failures must never
    // turn a successful restock into a 500 that the admin retries accidentally.
    let waited: { candidates: number; sent: number } | null = null;
    if (result.before.stock <= 0 && result.stock > 0) {
      try {
        const { getSettings, envFallback } = await import("@/lib/settings");
        const { notifyWaitlistForProduct } = await import("@/lib/waitlist");
        waited = await notifyWaitlistForProduct(productId, envFallback(await getSettings()), 10);
      } catch { /* inventory was already committed */ }
    }
    return NextResponse.json({ ok: true, stock: result.stock, delta: result.delta, costUpdated: unitCost !== null, waitlist: waited });
  } catch (e) {
    if (e instanceof StockAdjustmentError) return NextResponse.json({ error: e.message }, { status: e.status });
    if ((e as { code?: string })?.code === "P2034") return NextResponse.json({ error: "Stock changed concurrently. Please retry." }, { status: 409 });
    console.error("stock adjustment failed", e);
    return NextResponse.json({ error: "Could not adjust stock. Please try again." }, { status: 500 });
  }
}
