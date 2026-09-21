import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

/* Scan-to-pack.
   The packer points a barcode scanner (or types) at whatever is printed on the parcel:
   the order code, the courier consignment id, or a plain order number. Nothing is written
   until "Confirm pack" — scanning a parcel only WARNS (wrong area, already packed,
   cancelled) and shows the items to check off. */

async function resolveOrder(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  const digits = (v.match(/\d{2,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
  const or: any[] = [{ code: v }, { code: upper }, { courierConsignmentId: v }, { courierConsignmentId: upper }];
  if (/^\d+$/.test(v)) or.push({ id: Number(v) });
  if (digits && digits !== v) or.push({ id: Number(digits) });
  /* "1031" typed/scanned without the prefix still finds ORD-1031 (and "ord-1031" too).
     endsWith keeps ORD-1031 from matching ORD-10310. */
  if (digits.length >= 3) or.push({ code: { endsWith: digits } });
  return db.order.findFirst({
    where: { OR: or },
    include: { items: true },
    orderBy: { id: "desc" },
  });
}

export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  if (code) {
    const order = await resolveOrder(code);
    if (!order) return NextResponse.json({ error: `"${code}" — ei code/tracking diye kono order pay nai.` }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  }
  // queue: waiting to be packed, oldest first
  const [queue, recent] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["PENDING", "CONFIRMED", "PROCESSING"] } },
      orderBy: { createdAt: "asc" }, take: 25,
      select: { id: true, code: true, name: true, area: true, total: true, status: true, createdAt: true, packedAt: true },
    }),
    db.order.findMany({
      where: { packedAt: { not: null } },
      orderBy: { packedAt: "desc" }, take: 8,
      select: { id: true, code: true, name: true, packedAt: true, packedBy: true },
    }),
  ]);
  const [waiting, packedToday] = await Promise.all([
    db.order.count({ where: { status: { in: ["PENDING", "CONFIRMED", "PROCESSING"] } } }),
    db.order.count({ where: { packedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
  ]);
  return NextResponse.json({ ok: true, queue, recent, waiting, packedToday });
}

export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({}));
  const order = await resolveOrder(String(b.code || ""));
  if (!order) return NextResponse.json({ error: "Order not found for that code" }, { status: 404 });
  if (["CANCELLED", "RETURNED"].includes(order.status)) {
    return NextResponse.json({ error: `${order.code} is ${order.status} — do not pack this parcel.` }, { status: 400 });
  }
  if (order.packedAt) {
    return NextResponse.json({ ok: true, already: true, order, message: `${order.code} was already packed (${order.packedAt.toISOString().slice(0, 16).replace("T", " ")}${order.packedBy ? " by " + order.packedBy : ""})` });
  }
  const data: any = { packedAt: new Date(), packedBy: g.user.email };
  if (["PENDING", "CONFIRMED", "PROCESSING"].includes(order.status)) data.status = "PACKED";
  const updated = await db.order.update({ where: { id: order.id }, data, include: { items: true } });
  await logAudit(g.user.email, "ORDER_PACKED", `${order.code} packed (scan) — ${order.items.length} item(s), status ${order.status} → ${updated.status}`);
  await logApp("INFO", "WHATSAPP", `scan-to-pack: ${order.code} packed by ${g.user.email}`, { orderId: order.id }).catch(() => {});
  return NextResponse.json({ ok: true, order: updated });
}
