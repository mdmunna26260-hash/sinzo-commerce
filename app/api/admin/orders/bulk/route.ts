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
  }
  return NextResponse.json({ ok: true });
}
