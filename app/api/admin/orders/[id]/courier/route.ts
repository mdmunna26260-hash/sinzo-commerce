import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { createConsignment, checkStatusByConsignment } from "@/lib/steadfast";
import { logAudit } from "@/lib/auth";
import { emailCustomerStatus } from "@/lib/notify";
import { applyDeliveryStockDeduction } from "@/lib/deliver-stock";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function POST(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.courierConsignmentId) return NextResponse.json({ error: "Already sent to courier (" + order.courierConsignmentId + ")" }, { status: 400 });
  const r = await createConsignment(order);
  if (r.ok && r.data?.consignment_id) {
    await db.order.update({ where: { id: order.id }, data: { courierName: "Steadfast", courierConsignmentId: String(r.data.consignment_id), courierStatus: r.data.delivery_status || "in_review", status: order.status === "ON_HOLD" ? "SHIPPED" : order.status, courierTracking: JSON.stringify(r.data) } });
    await logAudit(g.user.email, "COURIER_SENT", `${order.code} → Steadfast consignment ${r.data.consignment_id} tracking ${r.data.tracking_code || "-"}`);
    // customer email: parcel handed to Steadfast (in review)
    if (order.email) {
      emailCustomerStatus(order.email, order.name, { code: order.code, total: order.total, area: order.area, courierName: "Steadfast" }, "in_review").catch(() => {});
    }
    return NextResponse.json({ ok: true, consignment: r.data });
  }
  return NextResponse.json({ ok: false, configured: r.configured, error: r.error }, { status: r.configured ? 502 : 400 });
}
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const order = await db.order.findUnique({ where: { id: Number(params.id) } });
  if (!order?.courierConsignmentId) return NextResponse.json({ error: "No courier consignment on this order" }, { status: 400 });
  const beforeStatus = order.courierStatus;
  const r = await checkStatusByConsignment(order.courierConsignmentId);
  if (r.ok) {
    const newStatus = r.data?.delivery_status || order.courierStatus;
    await db.order.update({ where: { id: order.id }, data: { courierStatus: newStatus, courierTracking: JSON.stringify(r.data) } }).catch(() => {});
    if (r.data?.delivery_status === "delivered") {
      await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED", paymentStatus: "PAID" } }).catch(() => {});
      // Stock: minus exactly once, here — on Steadfast "delivered".
      // Atomic claim (Order.stockDeducted) makes repeated syncs race-safe.
      await applyDeliveryStockDeduction(order.id, order.code).catch(() => {});
      // courier-confirmed delivery is the same event as a manual one: points + review ask
      const { onOrderDelivered } = await import("@/lib/on-delivered");
      await onOrderDelivered(order.id).catch(() => {});
    }
    // customer email on rider pickup / in transit (only on transition, never repeats)
    if (order.email && newStatus && beforeStatus !== newStatus && ["picked_up", "in_transit"].includes(String(newStatus))) {
      emailCustomerStatus(order.email, order.name, { code: order.code, total: order.total, area: order.area, courierName: order.courierName }, "rider").catch(() => {});
    }
    if (r.data?.delivery_status === "cancelled" && beforeStatus !== "cancelled") {
      await logAudit(g.user.email, "COURIER_STATUS", `${order.code}: ${beforeStatus} → cancelled (Steadfast)`);
    }
  }
  return NextResponse.json({ ok: r.ok, configured: r.configured, data: r.data, error: r.error });
}
