import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkStatusByTracking, checkStatusByConsignment, mapSteadfastStatus, readLiveStatus, cachedLiveBody, rememberLiveBody } from "@/lib/steadfast";
import { parseOrderCode } from "@/lib/slug";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { normalizeBDPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/* Public tracking by courier tracking number / consignment ID / our order code / phone.
 *
 * HARDENED 2026-09-15, relaxed on the owner's request 2026-09-16:
 *  • An ORD-#### code is sequential (ORD-1001, 1002 …) so on its own it is an
 *    enumeration key. It is only honoured together with the order's phone number
 *    (same rule as POST /api/track/order).
 *  • A bare phone number DOES show that number's orders with their items (owner asked:
 *    BD customers rarely keep the ORD- code, but always know their own mobile). The
 *    trade-off is deliberate and bounded — a BD mobile number is not a secret, so this
 *    path never returns name / address / notes / the number itself, and it is throttled
 *    per number (6/10min) on top of the per-IP limit, so it cannot be walked at scale.
 *  • Courier-issued tracking/consignment IDs stay single-field (they are long,
 *    unguessable, and already printed on the customer's parcel).
 *  • The old code loaded the last 500 orders and JSON.parsed every row per request;
 *    that is now an indexed where-clause. */
const FULL = {
  id: true, code: true, status: true, createdAt: true, courierName: true,
  courierConsignmentId: true, courierStatus: true, courierTracking: true, area: true,
  subtotal: true, discount: true, deliveryFee: true, total: true,
  paymentMethod: true, paymentStatus: true,
  items: { select: { title: true, variant: true, image: true, price: true, qty: true, preorder: true, preorderDate: true } },
} as const;

const GENERIC_MISS = { error: "No order found for that code. Check the code (and the phone number you ordered with)." };

/** Our own pipeline labels — shared by the ORD-code path and the phone path so both read the same. */
const ORDER_LABEL: Record<string, string> = {
  PENDING: "Order Received (Pending)", CONFIRMED: "Order Confirmed", PROCESSING: "Processing",
  PACKED: "Packed", SHIPPED: "Shipped", DELIVERED: "Delivered", CANCELLED: "Cancelled",
  RETURNED: "Returned", ON_HOLD: "On Hold",
};
const orderTone = (s: string) => (s === "DELIVERED" ? "ok" : s === "CANCELLED" || s === "RETURNED" ? "bad" : "info");

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
  // `q` is the single-field lookup the storefront now sends; `code` stays accepted so the
  // admin panel and every old /track?code=… link (emails, push, account page) keep working.
  const code = (u.searchParams.get("q") || u.searchParams.get("code") || "").trim().slice(0, 64);
  const phone = normalizeBDPhone(u.searchParams.get("phone") || "");
  const force = u.searchParams.get("refresh") === "1";
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

    // 4) bare phone number → that number's newest order, items included, + its older codes
    if (!order && /^01[3-9]\d{8}$/.test(code)) {
      if (!rateLimit("track-phone:" + code, 6, 10 * 60 * 1000)) {
        return NextResponse.json({ error: "Too many lookups for that number. Please wait 10 minutes." }, { status: 429 });
      }
      const rows = await db.order.findMany({ where: { phone: code }, select: FULL, orderBy: { id: "desc" }, take: 6 });
      if (rows.length) {
        const o = rows[0];
        const live = o.courierStatus ? mapSteadfastStatus(o.courierStatus) : null;
        return NextResponse.json({
          code: o.code, createdAt: o.createdAt, area: o.area,
          items: o.items, orderStatus: o.status,
          subtotal: o.subtotal, discount: o.discount, deliveryFee: o.deliveryFee, total: o.total,
          paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
          courierName: o.courierName || null, consignmentId: o.courierConsignmentId || null,
          source: "order", matchedBy: "phone",
          status: ORDER_LABEL[o.status] || o.status, tone: orderTone(o.status),
          ...(live ? { courierStatusLabel: live.label } : {}),
          notice: rows.length > 1
            ? `Showing your newest order (${o.code}). ${rows.length - 1} older order(s) on this number are listed below — tap one to open it.`
            : "Found by your mobile number.",
          otherOrders: rows.slice(1).map((r) => ({ code: r.code, createdAt: r.createdAt, status: r.status, label: ORDER_LABEL[r.status] || r.status })),
        });
      }
    }

    if (!order) {
      // Not ours → ask Steadfast directly (credentials stay server-side, keys never exposed).
      // A courier tracking number is long and unguessable, so this stays a single-field lookup,
      // and the customer gets the full live trail rather than only the current status.
      const cached = cachedLiveBody("tk:" + code.toLowerCase(), force);
      if (cached) return NextResponse.json({ ...cached.body, items: [], cached: true, checkedAt: new Date(cached.at).toISOString() });
      for (const [kind, call] of [["tracking", () => checkStatusByTracking(code)], [/^\d{6,}$/.test(code) ? "cid" : "", () => checkStatusByConsignment(code)]] as [string, () => Promise<any>][]) {
        if (!kind) continue;
        const r = await call();
        // Read the courier's reply through the normalizer, not one hard-coded key: a status
        // nested under `data` or named `current_status` used to be treated as "no answer",
        // which silently degraded a live shipment to the stored status.
        const live = readLiveStatus(r.data);
        if (!r.ok || (!live?.raw && !live?.events.length)) continue;
        const m = mapSteadfastStatus(live.raw);
        const body = {
          source: "steadfast", status: live.label, tone: live.tone,
          courierName: live.courier || "Steadfast", courierStatusRaw: live.raw,
          consignmentId: live?.consignmentId || null, live,
          matchedBy: kind === "cid" ? "consignment" : "tracking",
          notice: live?.events?.length ? undefined : "The courier reports a status but no event history for this shipment.",
        };
        rememberLiveBody("tk:" + code.toLowerCase(), body);
        return NextResponse.json({ ...body, items: [], checkedAt: new Date().toISOString() });
      }
      return NextResponse.json(GENERIC_MISS, { status: 404 });
    }

    const base = {
      code: order.code, createdAt: order.createdAt, area: order.area,
      items: order.items, orderStatus: order.status,
      subtotal: order.subtotal, discount: order.discount, deliveryFee: order.deliveryFee, total: order.total,
      paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
      courierName: order.courierName || null, consignmentId: order.courierConsignmentId || null,
    };

    // on courier → live status (with the event trail, so "In Transit" says where and when)
    if (order.courierConsignmentId) {
      const key = "cid:" + order.courierConsignmentId;
      const cached = cachedLiveBody(key, force);
      if (cached) return NextResponse.json({ ...base, ...cached.body, cached: true, checkedAt: new Date(cached.at).toISOString() });

      let r = await checkStatusByConsignment(order.courierConsignmentId);
      let tc = ""; try { tc = JSON.parse(order.courierTracking || "{}").tracking_code || ""; } catch {}
      let live = readLiveStatus(r.data);
      if ((!r.ok || (!live?.raw && !live?.events.length)) && tc) {
        r = await checkStatusByTracking(tc);
        live = readLiveStatus(r.data);
      }

      if (r.ok && (live?.raw || live?.events.length)) {
        const m = mapSteadfastStatus(live.raw);
        const body = {
          source: "steadfast", status: live.label, tone: live.tone,
          courierStatusRaw: live.raw, live,
          courierName: live.courier || order.courierName || "Steadfast",
          // never echo the courier's id blindly if we already know ours — one number, one label
          trackingCode: live.trackingCode || (tc || null),
        };
        rememberLiveBody(key, body);
        return NextResponse.json({ ...base, ...body, checkedAt: new Date().toISOString() });
      }
      // API issue → fall back to last stored status honestly (no fake live claim)
      const m = mapSteadfastStatus(order.courierStatus);
      return NextResponse.json({
        ...base, source: "stored", status: m.label, tone: m.tone, live: null,
        notice: "Live courier status is unavailable right now — showing the last recorded status.",
      });
    }

    // not on courier yet → honest order status
    return NextResponse.json({ ...base, source: "order", status: ORDER_LABEL[order.status] || order.status, tone: orderTone(order.status) });
  } catch {
    return NextResponse.json({ error: "Tracking is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
