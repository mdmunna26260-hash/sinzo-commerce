import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";

/* Hardened order list.
   The plain findMany returned HTTP 500 on the VPS for queries that matched
   certain rows (single-order GETs were fine) — a serialization failure on one
   bad row killed the WHOLE list. Strategy now:
   1. fetch ids only
   2. fetch full rows one page at a time
   3. if a page blows up, fall back to per-row fetch and skip the poison row
      (it is logged in TrackingEvent so we can see WHAT is wrong with it) */
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const where: any = {};
  const status = sp.get("status"); const q = sp.get("q"); const payment = sp.get("payment"); const source = sp.get("source");
  if (status) where.status = status;
  if (payment) where.paymentStatus = payment;
  if (source) where.source = source;
  if (q) {
    const qq = q.trim();
    where.OR = [{ code: { contains: qq } }, { phone: { contains: qq } }, { name: { contains: qq } }, { courierConsignmentId: { contains: qq } }];
  }
  const PAGE = 50;
  const ids = await db.order.findMany({ where, select: { id: true }, orderBy: { id: "desc" }, take: 200 });
  const orders: any[] = [];
  let skipped = 0;
  for (let i = 0; i < ids.length; i += PAGE) {
    const pageIds = ids.slice(i, i + PAGE).map((x) => x.id);
    try {
      const rows = await db.order.findMany({ where: { id: { in: pageIds } }, include: { items: true }, orderBy: { id: "desc" } });
      orders.push(...rows);
    } catch {
      // page failed → isolate the poison row(s) one by one
      for (const id of pageIds) {
        try {
          const row = await db.order.findUnique({ where: { id }, include: { items: true } });
          if (row) orders.push(row);
        } catch (e: any) {
          skipped++;
          await db.trackingEvent.create({ data: { name: "admin.orders.row_error", eventId: String(id), source: "capi", payload: `id=${id}`, ok: false, error: String(e?.message || e).slice(0, 300) } }).catch(() => {});
        }
      }
    }
  }
  return NextResponse.json({ orders, skipped });
}
