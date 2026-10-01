import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient;
type InventoryDb = Pick<Tx, "order" | "inventoryMovement">;
export class InventoryConflictError extends Error {}

/* Acquire the order's write lock before reading its status/items/claim flag.
   A zero increment works on both PostgreSQL and SQLite, including a previously
   read order whose status changed while another transaction held the lock. */
export async function lockOrder(tx: Tx, orderId: number) {
  const locked = await tx.order.updateMany({ where: { id: orderId }, data: { subtotal: { increment: 0 } } });
  return locked.count ? tx.order.findUnique({ where: { id: orderId }, include: { items: true } }) : null;
}

export async function stockWasDeducted(orderId: number, code: string, client: InventoryDb = db): Promise<boolean> {
  const order = await client.order.findUnique({ where: { id: orderId }, select: { stockDeducted: true, items: { select: { stockDeductedQty: true } } } });
  if (order?.stockDeducted && order.items.some((item) => item.stockDeductedQty !== null)) return true;
  // Pre-rollout orders were deducted at checkout. Older returns also left the
  // flag true, so their latest ledger movement, not that stale flag, decides.
  const last = await client.inventoryMovement.findFirst({
    where: { ref: code, reason: { in: ["ORDER", "DELIVERED", "CANCEL", "RETURN"] } },
    orderBy: { id: "desc" }, select: { reason: true },
  });
  if (last && ["CANCEL", "RETURN"].includes(last.reason)) return false;
  return !!order?.stockDeducted || last?.reason === "ORDER";
}

/* Delivery-time inventory policy is unchanged: pending orders never reserve
   stock. Both quantities are deducted together, never below zero. Persist the
   ACTUAL amount per line so a short-stock delivery cannot invent stock when it
   is returned. All flags, counts and ledger rows commit with the order status. */
async function deduct(tx: Tx, orderId: number, code: string) {
  const order = await lockOrder(tx, orderId);
  if (!order || order.status !== "DELIVERED") return;
  if (await stockWasDeducted(orderId, code, tx)) {
    if (!order.stockDeducted) await tx.order.update({ where: { id: orderId }, data: { stockDeducted: true } });
    return;
  }
  if (order.stockDeducted) await tx.order.update({ where: { id: orderId }, data: { stockDeducted: false } }); // stale legacy return flag
  const claimed = await tx.order.updateMany({ where: { id: orderId, stockDeducted: false }, data: { stockDeducted: true } });
  if (!claimed.count) return;
  const notes: string[] = [];
  // Stable lock order reduces cross-order deadlocks for multi-product parcels.
  const items = [...order.items].sort((a, b) => (a.productId || 0) - (b.productId || 0) || (a.variantId || 0) - (b.variantId || 0));
  for (const item of items) {
    let quantity = 0;
    if (item.productId) {
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
      const variant = item.variantId ? await tx.productVariant.findFirst({ where: { id: item.variantId, productId: item.productId }, select: { stock: true } }) : null;
      quantity = product ? Math.min(item.qty, Math.max(0, product.stock), item.variantId && variant ? Math.max(0, variant.stock) : Infinity) : 0;
      if (quantity > 0) {
        const changed = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (!changed.count) throw new InventoryConflictError("Stock changed during delivery. Please try again.");
        if (item.variantId && variant) {
          const changedVariant = await tx.productVariant.updateMany({ where: { id: item.variantId, productId: item.productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
          if (!changedVariant.count) throw new InventoryConflictError("Variant stock changed during delivery. Please try again.");
        }
        await tx.inventoryMovement.create({ data: { productId: item.productId, delta: -quantity, reason: "DELIVERED", ref: code } });
      }
      if (item.variantId && !variant) notes.push(`${item.title}: variant ${item.variantId} missing`);
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { stockDeductedQty: quantity } });
    if (quantity < item.qty) notes.push(`${item.title}: deducted ${quantity} of ${item.qty}`);
  }
  await tx.auditLog.create({ data: { userEmail: "system", action: "STOCK_DELIVERED", detail: `${code}: stock decremented on delivery` } });
  if (notes.length) await tx.auditLog.create({ data: { userEmail: "system", action: "STOCK_SHORTFALL", detail: `${code}: ${notes.join(" | ")}`.slice(0, 2000) } });
}

export async function applyDeliveryStockDeduction(orderId: number, code: string, tx?: Tx): Promise<void> {
  if (tx) return deduct(tx, orderId, code);
  await db.$transaction((client) => deduct(client, orderId, code));
}

async function restore(tx: Tx, orderId: number, code: string) {
  const order = await lockOrder(tx, orderId);
  if (!order || !["CANCELLED", "RETURNED"].includes(order.status)) return;
  if (!(await stockWasDeducted(orderId, code, tx))) {
    if (order.stockDeducted) await tx.order.update({ where: { id: orderId }, data: { stockDeducted: false } });
    return;
  }
  // The order lock serializes returns; resetting the flag permits a genuine
  // redelivery to deduct again, but duplicate return requests do nothing.
  await tx.order.update({ where: { id: orderId }, data: { stockDeducted: false } });
  for (const item of order.items) {
    const quantity = item.stockDeductedQty ?? item.qty; // legacy lines were fully deducted at checkout
    if (item.productId) {
      await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: quantity } } });
      if (item.variantId) await tx.productVariant.updateMany({ where: { id: item.variantId, productId: item.productId }, data: { stock: { increment: quantity } } });
      await tx.inventoryMovement.create({ data: { productId: item.productId, delta: quantity, reason: order.status === "CANCELLED" ? "CANCEL" : "RETURN", ref: code } });
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { stockDeductedQty: 0 } });
  }
}

export async function restoreOrderStock(orderId: number, code: string, tx?: Tx): Promise<void> {
  if (tx) return restore(tx, orderId, code);
  await db.$transaction((client) => restore(client, orderId, code));
}

/* Item edits on already-deducted orders adjust actual inventory. Edits on
   pending/returned orders never touch it. Positive delta consumes stock. */
export async function adjustItemStock(tx: Tx, item: { productId: number | null; variantId: number | null; title: string }, delta: number, code: string) {
  if (!item.productId || !delta) return;
  const product = await tx.product.updateMany({
    where: { id: item.productId, ...(delta > 0 ? { stock: { gte: delta } } : {}) },
    data: { stock: { decrement: delta } },
  });
  if (delta > 0 && !product.count) throw new InventoryConflictError(`Not enough stock for ${item.title}`);
  if (item.variantId) {
    const variant = await tx.productVariant.updateMany({
      where: { id: item.variantId, productId: item.productId, ...(delta > 0 ? { stock: { gte: delta } } : {}) },
      data: { stock: { decrement: delta } },
    });
    if (delta > 0 && !variant.count) throw new InventoryConflictError(`Not enough variant stock for ${item.title}`);
  }
  if (product.count) await tx.inventoryMovement.create({ data: { productId: item.productId, delta: -delta, reason: "MANUAL", ref: code } });
}
