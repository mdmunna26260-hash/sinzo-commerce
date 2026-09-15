import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkStatusByTracking, checkStatusByConsignment, mapSteadfastStatus } from "@/lib/steadfast";
import { parseOrderCode } from "@/lib/slug";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { normalizeBDPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/* Public tracking by courier tracking number / consignment ID / our order code.
 *
 * HARDENED 2026-09-15:
 *  • An ORD-#### code is sequential (ORD-1001, 1002 …) so on its own it is an
 *    enumeration key. It is now only honoured together with the order's phone number
 *    (same rule as POST /api/track/order).
 *  • A bare phone number returns STATUS ONLY — no item list, no area — because a BD
 *    mobile number is not a secret and this endpoint is public.
 *  • Courier-issued tracking/consignment IDs stay single-field (they are long,
 *    unguessable, and already printed on the customer's parcel).
 *  • The old code loaded the last 500 orders and JSON.parsed every row per request;
 *    that is now an indexed where-clause. */
const FULL = {
  id: true, code: true, status: true, createdAt: true, courierName: true,
  courierConsignmentId: true, courierStatus: true, courierTracking: true, area: true,
  items: { select: { title: true, qty: true } },
} as const;
const SLIM = { ...FULL, items: false } as const;

const GENERIC_MISS = { error: "No order found for that code. Check the code (and the phone number you ordered with)." };

async function findOrder(code: string) {
  // 1) consignment id (indexed equality)
  let order = await db.order.findFirst({ where: { courierConsignmentId: code }, select: FULL, orderBy: { id: "desc" } }).catch(() => null);
  // 2) steadfast tracking_code stored inside courierTracking JSON
  if (!order) {
    order = await db.order.findFirst({
      where: { courierTracking: { contains: code } },
      select: FULL, orderBy: { id: "desc" },
    }).catch(() => null).then((o) => {
      if (!o) return null;
      let tc = ""; try { tc = JSON.parse(o.courierTracking || "{}").tracking_code || ""; } catch {}
      return tc && tc.toLowerCase() === code.toLowerCase() ? o : null;
    });
  }
  return order;
}

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("track:" + ip, 15, 60 * 1000)) {
    return NextResponse.json({ error: "Too many lookups. Please wait a minute." }, { status: 429 });
  }
  const u = new URL(req.url);
  const code = (u.searchParams.get("code") || "").trim().slice(0, 64);
  const phone = normalizeBDPhone(u.searchParams.get("phone") || "");
  if (!code) return NextResponse.json({ error: "Enter your tracking number or order code." }, { status: 400 });

  try {
    let order = await findOrder(code);

    // 3) our own ORD-#### code — only with the matching phone
    if (!order) {
      const id = parseOrderCode(code);
      if (id != null) {
        if (!/^01[3-9]\d{8}$/.test(phone)) {
          return NextResponse.json({ error: "Enter the mobile number you ordered with, next to the order code.", needPhone: true }, { status: 400 });
        }
        order = await db.order.findFirst({ where: { id, phone }, select: FULL });
      }
    }

    // 4) bare phone number → status only
    if (!order && /^01[3-9]\d{8}$/.test(code)) {
      const slim = await db.order.findFirst({ where: { phone: code }, select: SLIM, orderBy: { id: "desc" } });
      if (slim) {
        const m = mapSteadfastStatus(slim.courierStatus);
        return NextResponse.json({
          code: slim.code, createdAt: slim.createdAt, status: slim.status, tone: ["DELIVERED"].includes(slim.status) ? "ok" : ["CANCELLED", "RETURNED"].includes(slim.status) ? "bad" : "info",
          source: "order", items: [], private: true,
          notice: "For item details, enter your order code (ORD-…) together with your mobile number.",
          courierName: slim.courierName || null, consignmentId: slim.courierConsignmentId || null,
          ...(slim.courierStatus ? { courierStatusLabel: m.label } : {}),
        });
      }
    }

    if (!order) {
      // Not ours → ask Steadfast directly (credentials stay server-side, keys never exposed)
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
      return NextResponse.json(GENERIC_MISS, { status: 404 });
    }

    const base = {
      code: order.code, createdAt: order.createdAt, area: order.area,
      items: order.items, orderStatus: order.status,
      courierName: order.courierName || null, consignmentId: order.courierConsignmentId || null,
    };

    // on courier → live status
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
      return NextResponse.json({ ...base, source: "stored", status: m.label, tone: m.tone, notice: "Live courier status is unavailable right now — showing the last recorded status." });
    }

    // not on courier yet → honest order status
    const map: Record<string, string> = { PENDING: "Order Received (Pending)", CONFIRMED: "Order Confirmed", PROCESSING: "Processing", PACKED: "Packed", SHIPPED: "Shipped", DELIVERED: "Delivered", CANCELLED: "Cancelled", RETURNED: "Returned", ON_HOLD: "On Hold" };
    return NextResponse.json({ ...base, source: "order", status: map[order.status] || order.status, tone: ["DELIVERED"].includes(order.status) ? "ok" : ["CANCELLED", "RETURNED"].includes(order.status) ? "bad" : "info" });
  } catch {
    return NextResponse.json({ error: "Tracking is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
