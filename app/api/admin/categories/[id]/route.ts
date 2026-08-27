import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const c = await db.category.update({ where: { id: Number(params.id) }, data: { name: b.name, description: b.description || null, image: b.image || null, sizeChart: b.sizeChart || null } });
  return NextResponse.json({ ok: true, category: c });
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  await db.category.delete({ where: { id: Number(params.id) } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
