import { db } from "./db";

/* ---- Inventory rule (Steadfast flow) ----
   Stock is decremented EXACTLY ONCE, when an order is DELIVERED:
   - Steadfast status sync reports "delivered" (admin courier GET), or
   - admin manually moves the order to DELIVERED.
   Stock is NEVER touched at order time, and never on cancellation.
   On delivery we subtract exactly what the customer ordered — the order's
   variant (size) stock AND the product stock, inside one DB transaction.

   Idempotency:
   - new orders  → Order.stockDeducted flag (set in the same transaction)
   - legacy orders (placed before this rollout) were already decremented at
     checkout → detect them via an existing "ORDER" inventory movement.
   Cancel/return restock is only applied when stock was actually deducted,
   so cancellations never inflate stock under the new flow. */

export async function stockWasDeducted(orderId: number, code: string): Promise<boolean> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { stockDeducted: true } }).catch(() => null);
  if (o?.stockDeducted) return true;
  const m = await db.inventoryMovement.findFirst({ where: { ref: code, reason: "ORDER" }, select: { id: true } }).catch(() => null);
  return !!m;
}

export async function applyDeliveryStockDeduction(orderId: number, code: string): Promise<void> {
  if (await stockWasDeducted(orderId, code)) return;
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;
  const notes: string[] = [];
  await db.$transaction(async (tx) => {
    // Atomic claim: flip the flag FIRST (UPDATE … WHERE stockDeducted = false).
    // A concurrent delivery hook (Steadfast sync + manual admin click) blocks
    // on this row lock, re-reads the flag as true, and bails — no double minus.
    const claimed = await tx.order.updateMany({ where: { id: orderId, stockDeducted: false }, data: { stockDeducted: true } });
    if (claimed.count === 0) return;
    for (const i of order.items) {
      if (!i.productId) continue;
      // exact variant (size/color) stock first
      if (i.variantId) {
        const v = await tx.productVariant.findUnique({ where: { id: i.variantId }, select: { stock: true } });
        if (v) {
          const dv = Math.min(i.qty, Math.max(0, v.stock));
          if (dv > 0) await tx.productVariant.update({ where: { id: i.variantId }, data: { stock: { decrement: dv } } });
          if (dv < i.qty) notes.push(`${i.title}${i.variant ? " (" + i.variant + ")" : ""}: variant stock ${v.stock} < qty ${i.qty}`);
        } else {
          notes.push(`${i.title}: variant ${i.variantId} missing`);
        }
      }
      // product-level stock (kept in sync, same convention as old checkout)
      const p = await tx.product.findUnique({ where: { id: i.productId }, select: { stock: true } });
      if (!p) continue;
      const dp = Math.min(i.qty, Math.max(0, p.stock));
      if (dp > 0) await tx.product.update({ where: { id: i.productId }, data: { stock: { decrement: dp } } });
      if (dp < i.qty) notes.push(`${i.title}: product stock ${p.stock} < qty ${i.qty}`);
      if (dp > 0) await tx.inventoryMovement.create({ data: { productId: i.productId, delta: -dp, reason: "DELIVERED", ref: code } });
    }
    await tx.auditLog.create({ data: { userEmail: "system", action: "STOCK_DELIVERED", detail: `${code}: stock decremented on delivery` } });
  });
  if (notes.length) {
    await db.auditLog.create({ data: { userEmail: "system", action: "STOCK_SHORTFALL", detail: `${code}: ${notes.join(" | ")}` } }).catch(() => {});
  }
}
