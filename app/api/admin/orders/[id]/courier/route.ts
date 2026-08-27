import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { createConsignment, checkStatusByConsignment } from "@/lib/steadfast";
import { logAudit } from "@/lib/auth";
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
    return NextResponse.json({ ok: true, consignment: r.data });
  }
  return NextResponse.json({ ok: false, configured: r.configured, error: r.error }, { status: r.configured ? 502 : 400 });
}
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const order = await db.order.findUnique({ where: { id: Number(params.id) } });
  if (!order?.courierConsignmentId) return NextResponse.json({ error: "No courier consignment on this order" }, { status: 400 });
  const r = await checkStatusByConsignment(order.courierConsignmentId);
  if (r.ok) {
    await db.order.update({ where: { id: order.id }, data: { courierStatus: r.data?.delivery_status || order.courierStatus, courierTracking: JSON.stringify(r.data) } }).catch(() => {});
    if (r.data?.delivery_status === "delivered") await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED", paymentStatus: "PAID" } }).catch(() => {});
  }
  return NextResponse.json({ ok: r.ok, configured: r.configured, data: r.data, error: r.error });
}
