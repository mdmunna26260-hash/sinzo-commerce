import { db } from "./db";
import { ensureExtraTables } from "./db-ensure";
import { lockOrder, stockWasDeducted } from "./deliver-stock";

export class OrderDeletionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/* Hard deletion is reserved for unfulfilled/admin-test orders. A delivered order
   may already have changed inventory, loyalty and accounting records; silently
   deleting it would make those ledgers disagree. Return/cancel it first, then the
   same endpoint can safely remove it. */
export async function deleteAdminOrder(orderId: number, userEmail: string) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new OrderDeletionError("Invalid order ID");
  await ensureExtraTables();
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new OrderDeletionError("Order not found", 404);
    if (order.status === "DELIVERED" || await stockWasDeducted(order.id, order.code, tx)) {
      throw new OrderDeletionError("Delivered orders cannot be deleted directly. Mark the order RETURNED first so inventory is restored.", 409);
    }
    if (order.courierConsignmentId && !["CANCELLED", "RETURNED"].includes(order.status)) {
      throw new OrderDeletionError("This order is already with a courier. Cancel or return it before deleting.", 409);
    }

    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    }

    // A browser capture converted to this order must not become a permanent
    // dead-end after an admin removes a test/fraudulent order.
    await tx.abandonedCheckout.updateMany({
      where: { convertedOrderId: order.id },
      data: { convertedOrderId: null, checkoutStatus: "OPEN", recovered: false },
    });

    // Do not let queued automations message a customer about an order that no
    // longer exists. Sent message/inbox history is retained, only unlinked.
    await tx.waMessage.updateMany({
      where: { orderId: order.id, status: { in: ["QUEUED", "SENDING"] } },
      data: { status: "SKIPPED", orderId: null, error: "Order deleted by admin", lockedAt: null, nextAttemptAt: null },
    });
    await tx.waMessage.updateMany({ where: { orderId: order.id }, data: { orderId: null } });
    await tx.inboxMessage.updateMany({ where: { orderId: order.id }, data: { orderId: null } });

    await tx.order.delete({ where: { id: order.id } });
    await tx.auditLog.create({
      data: { userEmail, action: "ORDER_DELETED", detail: `${order.code} (#${order.id}) · ${order.name} · ৳${Math.round(order.total)}` },
    });
    return { id: order.id, code: order.code };
  }, { maxWait: 10_000, timeout: 20_000 });
}
