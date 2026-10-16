import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { updateOrder, ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/order-mutations";
import { logAudit } from "@/lib/auth";
import { deleteAdminOrder } from "@/lib/order-deletion";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const { ids, action, value } = body;
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  const orderIds = [...new Set(ids.map(Number))];
  if (orderIds.length > 200 || orderIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return NextResponse.json({ error: "Invalid order IDs (maximum 200)" }, { status: 400 });
  if (action === "status") {
    if (!ORDER_STATUSES.includes(value)) return NextResponse.json({ error: "Invalid order status" }, { status: 400 });
    const results: { id: number; ok: boolean; error?: string }[] = [];
    for (const id of orderIds) {
      try { await updateOrder(id, { status: value }, g.user.email); results.push({ id, ok: true }); }
      catch (e: any) { results.push({ id, ok: false, error: e?.message || "Update failed" }); }
    }
    const updated = results.filter((r) => r.ok).length;
    await logAudit(g.user.email, "BULK_STATUS", `${updated}/${orderIds.length} orders → ${value}`);
    return NextResponse.json({ ok: updated === orderIds.length, updated, failed: orderIds.length - updated, results }, { status: updated === orderIds.length ? 200 : 409 });
  } else if (action === "payment") {
    if (!PAYMENT_STATUSES.includes(value)) return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
    await db.order.updateMany({ where: { id: { in: orderIds } }, data: { paymentStatus: value } });
    await logAudit(g.user.email, "BULK_PAYMENT", `${ids.length} orders → ${value}`);
  } else if (action === "delete") {
    const results: { id: number; ok: boolean; code?: string; error?: string }[] = [];
    for (const id of orderIds) {
      try {
        const deleted = await deleteAdminOrder(id, g.user.email);
        results.push({ id, code: deleted.code, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || "Delete failed" });
      }
    }
    const deleted = results.filter((result) => result.ok).length;
    await logAudit(g.user.email, "BULK_DELETE", `${deleted}/${orderIds.length} orders deleted`);
    return NextResponse.json({ ok: deleted === orderIds.length, deleted, failed: orderIds.length - deleted, results }, { status: deleted === orderIds.length ? 200 : 409 });
  } else if (action === "courier") {
    // bulk send to Steadfast: per-order (needs order details); failures collected
    const { createConsignment } = await import("@/lib/steadfast");
    const results: { code: string; ok: boolean; error?: string; consignment?: string }[] = [];
    for (const id of orderIds) {
      const order = await db.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) { results.push({ code: "#" + id, ok: false, error: "not found" }); continue; }
      if (order.courierConsignmentId) { results.push({ code: order.code, ok: false, error: "already sent" }); continue; }
      const r = await createConsignment(order);
      if (r.ok && r.data?.consignment_id) {
        await db.order.update({ where: { id: order.id }, data: { courierName: "Steadfast", courierConsignmentId: String(r.data.consignment_id), courierStatus: r.data.delivery_status || "in_review", status: order.status === "ON_HOLD" ? "SHIPPED" : order.status, courierTracking: JSON.stringify(r.data) } });
        results.push({ code: order.code, ok: true, consignment: String(r.data.consignment_id) });
      } else {
        results.push({ code: order.code, ok: false, error: r.error || "failed" });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    await logAudit(g.user.email, "BULK_COURIER", `${sent}/${results.length} sent to Steadfast`);
    return NextResponse.json({ ok: true, sent, failed: results.length - sent, results });
  } else {
    return NextResponse.json({ error: "Unknown bulk action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
