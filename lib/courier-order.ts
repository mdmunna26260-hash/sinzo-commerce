type CourierOrder = {
  total: number;
  status?: string;
  paymentStatus?: string;
  payments?: { amount: number; kind: string }[];
};

/* Never book completed/closed orders, or collect prepaid/advance money twice. */
export function courierCollectAmount(order: CourierOrder): number {
  if (["DELIVERED", "CANCELLED", "RETURNED"].includes(order.status || "")) {
    throw new Error("Delivered, cancelled or returned orders cannot be sent to courier.");
  }
  if (!Number.isFinite(order.total) || order.total < 0) throw new Error("Invalid order total.");
  if (order.paymentStatus === "PAID") return 0;
  const payments = order.payments || [];
  if (order.paymentStatus === "PARTIAL" && !payments.length) {
    throw new Error("Record the advance payment before sending a partially paid order to courier.");
  }
  let received = 0;
  for (const payment of payments) {
    if (!Number.isFinite(payment.amount) || payment.amount < 0) throw new Error("Invalid payment ledger. Review before courier booking.");
    received += payment.kind === "REFUND" ? -payment.amount : payment.amount;
  }
  // Refunds without a legacy receipt row must not increase the bill above its total.
  return Math.max(0, Math.round(order.total - Math.max(0, received)));
}
