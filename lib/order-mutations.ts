import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ensureExtraTables } from "./db-ensure";
import { lockOrder, stockWasDeducted, applyDeliveryStockDeduction, restoreOrderStock, adjustItemStock } from "./deliver-stock";
import { roundMoney } from "./checkout-pricing";
import { normalizeBDPhone, isValidBDPhone } from "./phone";
import { logAudit } from "./auth";
import { notifyAdmin, emailCustomerStatus } from "./notify";
import { sendPushToPhones } from "./webpush";

export const ORDER_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];
export const PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID", "FAILED", "REFUNDED"];
export class OrderMutationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function amount(value: unknown, field: string): number {
  const number = Number(value);
  if (!["number", "string"].includes(typeof value) || value === "" || !Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new OrderMutationError(`${field} must be a non-negative amount`);
  return roundMoney(number);
}

async function editItems(tx: Prisma.TransactionClient, before: Awaited<ReturnType<typeof lockOrder>>, incoming: any[], userEmail: string) {
  if (!incoming.length || incoming.length > 100) throw new OrderMutationError("Order must have between 1 and 100 items");
  const deducted = await stockWasDeducted(before.id, before.code, tx);
  const existing = new Map(before.items.map((item) => [item.id, item]));
  const kept = new Set<number>();
  let subtotal = 0;

  for (const item of before.items) {
    if (incoming.some((input) => input?.id != null && Number(input.id) === item.id)) continue;
    if (deducted) await adjustItemStock(tx, item, -(item.stockDeductedQty ?? item.qty), before.code);
    await tx.orderItem.delete({ where: { id: item.id } });
  }

  for (const input of incoming) {
    if (!input || typeof input !== "object") throw new OrderMutationError("Invalid order item");
    const qty = Number(input.qty);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw new OrderMutationError("Item quantity must be a whole number between 1 and 999");
    if (input.id != null) {
      const item = existing.get(Number(input.id));
      if (!item || kept.has(item.id)) throw new OrderMutationError("Invalid or duplicate order item ID");
      kept.add(item.id);
      if ((input.productId != null && Number(input.productId) !== item.productId) || (input.variantId != null && Number(input.variantId) !== item.variantId)) throw new OrderMutationError("To change a product/variant, remove the old line and add a new one");
      const price = input.price === undefined ? item.price : amount(input.price, "Price");
      let stockDeductedQty = item.stockDeductedQty;
      if (deducted) {
        const oldDeduction = stockDeductedQty ?? item.qty;
        stockDeductedQty = qty >= item.qty ? oldDeduction + qty - item.qty : Math.min(oldDeduction, qty);
        await adjustItemStock(tx, item, stockDeductedQty - oldDeduction, before.code);
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { price, qty, stockDeductedQty } });
      subtotal = roundMoney(subtotal + price * qty);
    } else {
      const productId = Number(input.productId);
      if (!Number.isSafeInteger(productId) || productId <= 0) throw new OrderMutationError("New item rows need a valid productId");
      const product = await tx.product.findUnique({ where: { id: productId }, include: { variants: true, images: { orderBy: { position: "asc" }, take: 1 } } });
      if (!product || product.status === "ARCHIVED") throw new OrderMutationError("Product not found");
      const variant = input.variantId == null ? null : product.variants.find((v) => v.id === Number(input.variantId));
      if (input.variantId != null && !variant) throw new OrderMutationError("Invalid variant for this product");
      if (product.variants.length && !variant) throw new OrderMutationError("Select a product size/color");
      const price = input.price === undefined ? variant?.price ?? product.price : amount(input.price, "Price");
      const item = { productId, variantId: variant?.id ?? null, title: product.title };
      if (deducted) await adjustItemStock(tx, item, qty, before.code);
      await tx.orderItem.create({ data: {
        ...item, orderId: before.id, variant: variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : null,
        price, qty, image: product.images[0]?.url || null, preorder: product.preorder,
        preorderDate: product.preorderDate, stockDeductedQty: deducted ? qty : null,
      } });
      subtotal = roundMoney(subtotal + price * qty);
    }
  }
  await tx.auditLog.create({ data: { userEmail, action: "ORDER_ITEMS_EDIT", detail: `${before.code}: ${before.items.length}→${incoming.length} items` } });
  return subtotal;
}

/* Single, bulk, and courier status changes all use this path. Order status,
   inventory flags, item edits, and stock movements are one atomic mutation. */
export async function updateOrder(orderId: number, body: Record<string, any>, userEmail: string) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new OrderMutationError("Invalid order ID");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OrderMutationError("Invalid order update");
  if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) throw new OrderMutationError("Invalid order status");
  if (body.paymentStatus !== undefined && !PAYMENT_STATUSES.includes(body.paymentStatus)) throw new OrderMutationError("Invalid payment status");
  if (body.items !== undefined && !Array.isArray(body.items)) throw new OrderMutationError("Invalid items");
  const data: Prisma.OrderUpdateInput = {};
  for (const key of ["status", "paymentStatus", "courierStatus", "courierTracking"]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string") throw new OrderMutationError(`Invalid ${key}`);
      data[key] = body[key];
    }
  }
  if (body.adminNote !== undefined) {
    if (body.adminNote !== null && typeof body.adminNote !== "string") throw new OrderMutationError("Invalid admin note");
    data.adminNote = body.adminNote?.slice(0, 2000) ?? null;
  }
  for (const [key, min, max] of [["name", 3, 80], ["address", 10, 1000]] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string" || body[key].trim().length < min || body[key].trim().length > max) throw new OrderMutationError(`Invalid ${key}`);
      data[key] = body[key].trim();
    }
  }
  if (body.phone !== undefined) {
    const phone = normalizeBDPhone(String(body.phone));
    if (!isValidBDPhone(phone)) throw new OrderMutationError("Invalid BD mobile number");
    data.phone = phone;
  }
  if (body.deliveryFee !== undefined && body.deliveryFee !== "") data.deliveryFee = amount(body.deliveryFee, "Delivery fee");
  if (body.total !== undefined && body.total !== "") data.total = amount(body.total, "Total");
  await ensureExtraTables();

  const result = await db.$transaction(async (tx) => {
    const before = await lockOrder(tx, orderId);
    if (!before) throw new OrderMutationError("Order not found", 404);
    if (body.items) {
      const subtotal = await editItems(tx, before, body.items, userEmail);
      const deliveryFee = typeof data.deliveryFee === "number" ? data.deliveryFee : before.deliveryFee;
      const discount = Math.min(subtotal, before.discount);
      // Preserve the checkout's extra gift-wrap charge when changing quantities.
      const extras = before.notes?.includes("GIFT WRAP") ? Math.max(0, before.total - (Math.max(0, before.subtotal - before.discount) + before.deliveryFee)) : 0;
      data.subtotal = subtotal;
      data.discount = discount;
      data.deliveryFee = deliveryFee;
      if (data.total === undefined) data.total = roundMoney(Math.max(0, subtotal - discount) + deliveryFee + extras);
    } else if (data.deliveryFee !== undefined && data.total === undefined) {
      data.total = roundMoney(Math.max(0, before.total - before.deliveryFee + Number(data.deliveryFee)));
    }
    await tx.order.update({ where: { id: orderId }, data });
    if (body.status === "DELIVERED") await applyDeliveryStockDeduction(orderId, before.code, tx);
    if (["CANCELLED", "RETURNED"].includes(body.status)) await restoreOrderStock(orderId, before.code, tx);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    return { before, order };
  }, { maxWait: 10_000, timeout: 20_000 });

  await afterOrderChange(result.before, result.order, userEmail, body.status !== undefined);
  return result.order;
}

async function afterOrderChange(before: { id: number; code: string; status: string; name: string; phone: string; email?: string | null; total: number; area: string; courierName?: string | null }, order: { status: string }, userEmail: string, statusRequested: boolean) {
  if (!statusRequested) return;
  const status = order.status;
  if (status === "DELIVERED") {
    const { onOrderDelivered } = await import("./on-delivered");
    await onOrderDelivered(before.id).catch(() => {});
  }
  if (status === before.status) return;
  await logAudit(userEmail, "ORDER_STATUS", `${before.code}: ${before.status} → ${status}`);
  const evtMap: Record<string, any> = { CONFIRMED: "order.confirmed", CANCELLED: "order.cancelled", SHIPPED: "order.shipped", DELIVERED: "order.delivered" };
  const evt = evtMap[status];
  if (evt) notifyAdmin(evt, `Order ${before.code} → ${status}`, `${before.name} · ৳${Math.round(before.total).toLocaleString("en-IN")}`, before.code).catch(() => {});
  await import("./wa-queue").then(async ({ eventForStatus, enqueueOrderEvent }) => {
    const event = eventForStatus(status);
    if (event) await enqueueOrderEvent(before.id, event);
  }).catch(() => {});
  import("./sms").then(async ({ autoSmsOnStatus }) => {
    const { getSettings, envFallback } = await import("./settings");
    await autoSmsOnStatus(envFallback(await getSettings()), status, before);
  }).catch(() => {});
  if (status === "CANCELLED" && before.email) emailCustomerStatus(before.email, before.name, before, "cancelled").catch(() => {});
  const pushMap: Record<string, { title: string; body: string }> = {
    CONFIRMED: { title: "Order confirmed ✓", body: `Apnar order ${before.code} confirm hoyeche. Shighroi dispatch hobe.` },
    SHIPPED: { title: "Parcel shipped", body: `Order ${before.code} courier-te pathano hoyeche. Track korun.` },
    DELIVERED: { title: "Delivered", body: `Order ${before.code} deliver hoyeche. Dhonnobad!` },
    CANCELLED: { title: "Order cancelled", body: `Order ${before.code} cancel kora hoyeche.` },
  };
  const push = pushMap[status];
  if (push) sendPushToPhones([before.phone], { ...push, url: `/track?code=${before.code}`, tag: before.code }).catch(() => {});
}
