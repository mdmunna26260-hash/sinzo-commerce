import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ids, action, value } = await req.json();
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  if (action === "status") {
    await db.order.updateMany({ where: { id: { in: ids.map(Number) } }, data: { status: value } });
    await logAudit(g.user.email, "BULK_STATUS", `${ids.length} orders → ${value}`);
  } else if (action === "payment") {
    await db.order.updateMany({ where: { id: { in: ids.map(Number) } }, data: { paymentStatus: value } });
    await logAudit(g.user.email, "BULK_PAYMENT", `${ids.length} orders → ${value}`);
  } else if (action === "delete") {
    await db.order.deleteMany({ where: { id: { in: ids.map(Number) } } });
    await logAudit(g.user.email, "BULK_DELETE", `${ids.length} orders deleted`);
  } else if (action === "courier") {
    // bulk send to Steadfast: per-order (needs order details); failures collected
    const { createConsignment } = await import("@/lib/steadfast");
    const results: { code: string; ok: boolean; error?: string; consignment?: string }[] = [];
    for (const id of ids.map(Number)) {
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
  }
  return NextResponse.json({ ok: true });
}
