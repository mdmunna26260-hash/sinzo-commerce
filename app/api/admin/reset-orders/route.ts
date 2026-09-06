import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* TEMPORARY one-off maintenance route (removed right after use).
   Wipes ALL order data + resets identity sequences.
   SUPER_ADMIN only + explicit { confirm: "RESET-ALL-ORDERS" } body. */
export async function POST(req: Request) {
  const g = await requirePerm("users", req); // users perm = SUPER_ADMIN only
  if ("res" in g) return g.res;
  if (g.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (b.confirm !== "RESET-ALL-ORDERS") {
    return NextResponse.json({ error: 'Send { confirm: "RESET-ALL-ORDERS" } to proceed' }, { status: 400 });
  }
  const counts: Record<string, number> = {};
  counts.orderItems = await db.orderItem.deleteMany().then((r) => r.count);
  counts.orders = await db.order.deleteMany().then((r) => r.count);
  counts.abandoned = await db.abandonedCheckout.deleteMany().then((r) => r.count);
  counts.trackingEvents = await db.trackingEvent.deleteMany().then((r) => r.count);
  counts.notifications = await db.notification.deleteMany().then((r) => r.count);
  // reset identity sequences so new orders start at 1 again
  try {
    await db.$executeRawUnsafe(`ALTER SEQUENCE "Order_id_seq" RESTART WITH 1`);
    await db.$executeRawUnsafe(`ALTER SEQUENCE "OrderItem_id_seq" RESTART WITH 1`);
  } catch {}
  await logAudit(g.user.email, "RESET_ALL_ORDERS", JSON.stringify(counts));
  return NextResponse.json({ ok: true, counts });
}
