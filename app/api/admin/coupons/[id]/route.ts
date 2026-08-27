import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const c = await db.coupon.update({ where: { id: Number(params.id) }, data: { active: !!b.active } });
  return NextResponse.json({ ok: true, coupon: c });
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  await db.coupon.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}
