import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  const { status, featured } = await req.json();
  const r = await db.review.update({ where: { id: Number(params.id) }, data: { status, featured: featured !== undefined ? !!featured : undefined } });
  return NextResponse.json({ ok: true, review: r });
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  await db.review.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}
