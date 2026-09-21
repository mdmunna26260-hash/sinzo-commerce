import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* Stock movements written by hand: a restock (parcels in from the supplier) or a correction.
   Everything else in the ledger is written by the system (DELIVERED on courier delivery, CANCEL
   and RETURN on status change, MANUAL/ADJUST when an order or the product form is edited) — this
   is the missing "stock went UP" half, which is why the history used to be one-way. */
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const productId = Number(url.searchParams.get("product") || 0);
  const rows = await db.inventoryMovement.findMany({
    where: productId ? { productId } : {},
    orderBy: { id: "desc" },
    take: Math.min(200, Number(url.searchParams.get("take") || 50)),
    include: { product: { select: { title: true, sku: true } } },
  });
  return NextResponse.json({ movements: rows });
}

export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    const productId = Number(b.productId);
    if (!productId) return NextResponse.json({ error: "Pick a product" }, { status: 400 });
    const qty = Math.round(Number(b.qty));
    if (!Number.isFinite(qty) || qty === 0) return NextResponse.json({ error: "Quantity must be a non-zero number" }, { status: 400 });

    const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, stock: true, cost: true } });
    if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    // "add" (a delivery from the supplier arrived) or "set" (counted the shelf, this is the truth)
    const mode = b.mode === "set" ? "set" : "add";
    const nextStock = mode === "set" ? qty : p.stock + qty;
    if (nextStock < 0) return NextResponse.json({ error: `That would leave stock at ${nextStock}. Current stock: ${p.stock}.` }, { status: 400 });

    const unitCost = b.unitCost === "" || b.unitCost == null ? null : Number(b.unitCost);
    const note = b.note ? String(b.note).slice(0, 120) : "";

    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: nextStock,
          // the latest purchase price is the best cost we have for margin reporting
          ...(unitCost != null && Number.isFinite(unitCost) && unitCost > 0 ? { cost: unitCost } : {}),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          productId,
          delta: nextStock - p.stock,
          reason: mode === "set" ? "ADJUST" : qty > 0 ? "RESTOCK" : "MANUAL",
          ref: note || g.user.email,
        },
      });
    });

    await logAudit(
      g.user.email,
      mode === "set" ? "STOCK_SET" : "STOCK_RESTOCK",
      `${p.title}: ${p.stock} → ${nextStock}${unitCost ? ` @ ৳${unitCost}` : ""}${note ? " · " + note : ""}`
    );
    return NextResponse.json({ ok: true, stock: nextStock, delta: nextStock - p.stock, costUpdated: unitCost != null && unitCost > 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
