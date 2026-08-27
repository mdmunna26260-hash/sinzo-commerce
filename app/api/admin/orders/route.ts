import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
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
  const orders = await db.order.findMany({ where, include: { items: true }, orderBy: { id: "desc" }, take: 200 });
  return NextResponse.json({ orders });
}
