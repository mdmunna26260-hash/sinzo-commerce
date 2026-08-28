import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkStatusByTracking, checkStatusByConsignment, mapSteadfastStatus } from "@/lib/steadfast";
import { parseOrderCode } from "@/lib/slug";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";
/* Public tracking by tracking number / consignment ID / order code — single field.
   Steadfast credentials stay server-side; only mapped status reaches the client. */
export async function GET(req: Request) {
  if (!rateLimit("track:" + getClientIp(req), 30, 60 * 1000)) {
    return NextResponse.json({ error: "Too many lookups. Please wait a minute." }, { status: 429 });
  }
  const code = (new URL(req.url).searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ error: "Tracking number din" }, { status: 400 });

  // find order by: steadfast tracking_code / consignment id / our ORD-xxxx code
  let order = null;
  const consignments = await db.order.findMany({
    where: { courierConsignmentId: { not: null } },
    select: { id: true, code: true, status: true, createdAt: true, courierName: true, courierConsignmentId: true, courierStatus: true, courierTracking: true, items: { select: { title: true, qty: true } }, area: true },
    orderBy: { id: "desc" }, take: 500,
  }).catch(() => []);
  for (const o of consignments) {
    let tc = ""; try { tc = JSON.parse(o.courierTracking || "{}").tracking_code || ""; } catch {}
    if (tc && tc.toLowerCase() === code.toLowerCase()) { order = o; break; }
    if (o.courierConsignmentId === code) { order = o; break; }
  }
  if (!order) {
    const id = parseOrderCode(code);
    if (id != null) {
      const o = await db.order.findFirst({
        where: { id },
        select: { id: true, code: true, status: true, createdAt: true, courierName: true, courierConsignmentId: true, courierStatus: true, courierTracking: true, items: { select: { title: true, qty: true } }, area: true },
      });
      if (o) order = o;
    }
  }
  // also search by customer phone number
  if (!order && /^01[3-9]\d{8}$/.test(code.replace(/[\s-]/g, ""))) {
    const cleanPhone = code.replace(/[\s-]/g, "");
    const o = await db.order.findFirst({
      where: { phone: cleanPhone },
      orderBy: { id: "desc" },
      select: { id: true, code: true, status: true, createdAt: true, courierName: true, courierConsignmentId: true, courierStatus: true, courierTracking: true, items: { select: { title: true, qty: true } }, area: true },
    });
    if (o) order = o;
  }
  if (!order) {
    // Not in our DB → query Steadfast directly by tracking code (server-side, keys safe).
    const r = await checkStatusByTracking(code);
    if (r.ok && r.data?.delivery_status !== undefined) {
      const m = mapSteadfastStatus(r.data.delivery_status);
      return NextResponse.json({ source: "steadfast", courierName: "Steadfast", status: m.label, tone: m.tone, courierStatusRaw: r.data.delivery_status, items: [] });
    }
    if (/^\d{6,}$/.test(code)) {
      const rc = await checkStatusByConsignment(code);
      if (rc.ok && rc.data?.delivery_status !== undefined) {
        const m = mapSteadfastStatus(rc.data.delivery_status);
        return NextResponse.json({ source: "steadfast", courierName: "Steadfast", status: m.label, tone: m.tone, courierStatusRaw: rc.data.delivery_status, items: [] });
      }
    }
    return NextResponse.json({ error: "Kono order pay nai ei tracking number-e. Code abar check korun." }, { status: 404 });
  }

  const base = {
    code: order.code, createdAt: order.createdAt, area: order.area,
    items: order.items, orderStatus: order.status,
    courierName: order.courierName || null, consignmentId: order.courierConsignmentId || null,
  };

  // if on courier → live status from Steadfast (server-side, keys never exposed)
  if (order.courierConsignmentId) {
    let r = await checkStatusByConsignment(order.courierConsignmentId);
    if (!r.ok) {
      let tc = ""; try { tc = JSON.parse(order.courierTracking || "{}").tracking_code || ""; } catch {}
      if (tc) r = await checkStatusByTracking(tc);
    }
    if (r.ok && r.data?.delivery_status) {
      const m = mapSteadfastStatus(r.data.delivery_status);
      return NextResponse.json({ ...base, source: "steadfast", courierStatusRaw: r.data.delivery_status, status: m.label, tone: m.tone });
    }
    // API issue → fall back to last stored status honestly (no fake live claim)
    const m = mapSteadfastStatus(order.courierStatus);
    return NextResponse.json({ ...base, source: "stored", status: m.label, tone: m.tone, notice: "Live courier status ekhon ashe nai — shesh jana status dekhacche." });
  }
  // not on courier yet → honest order status
  const map: Record<string, string> = { PENDING: "Order Received (Pending)", CONFIRMED: "Order Confirmed", PROCESSING: "Processing", PACKED: "Packed", SHIPPED: "Shipped", DELIVERED: "Delivered", CANCELLED: "Cancelled", RETURNED: "Returned", ON_HOLD: "On Hold" };
  return NextResponse.json({ ...base, source: "order", status: map[order.status] || order.status, tone: ["DELIVERED"].includes(order.status) ? "ok" : ["CANCELLED", "RETURNED"].includes(order.status) ? "bad" : "info" });
}
