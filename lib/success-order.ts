import { db } from "./db";
import { isValidBDPhone, normalizeBDPhone } from "./phone";

/* Sequential codes alone must never unlock a customer's receipt. Match the
   checkout phone too, just as the existing invoice/tracking pages do. */
export async function getSuccessOrder(code: unknown, rawPhone: unknown) {
  if (typeof code !== "string" || !/^ORD-\d{4,14}$/i.test(code.trim()) || typeof rawPhone !== "string" || rawPhone.length > 32) return null;
  const phone = normalizeBDPhone(rawPhone);
  if (!isValidBDPhone(phone)) return null;
  const order = await db.order.findFirst({
    where: { code: code.trim().toUpperCase(), phone },
    select: {
      code: true, phone: true, area: true, subtotal: true, discount: true,
      deliveryFee: true, total: true, status: true, paymentMethod: true, paymentStatus: true,
      items: { select: { title: true, variant: true, qty: true, price: true, image: true, productId: true, preorder: true,
        product: { select: { images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } } },
      } },
      payments: { select: { amount: true, kind: true } },
    },
  });
  if (!order) return null;
  const received = order.payments.reduce((sum, row) => sum + (row.kind === "REFUND" ? -row.amount : row.amount), 0);
  const balance = order.paymentStatus === "PAID" ? 0 : Math.max(0, order.total - Math.max(0, received));
  return {
    code: order.code, phone: order.phone, area: order.area, subtotal: order.subtotal, discount: order.discount,
    deliveryFee: order.deliveryFee, total: order.total, status: order.status,
    paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
    // A legacy PARTIAL status without ledger rows is not a known balance.
    balance: order.paymentStatus === "PARTIAL" && !order.payments.length ? null : balance,
    items: order.items.map(({ product, ...item }) => ({ ...item, image: item.image || product?.images[0]?.url || null })),
  };
}
export type SuccessOrder = NonNullable<Awaited<ReturnType<typeof getSuccessOrder>>>;
