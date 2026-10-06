import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = Number(params.id);
  if (b.productIds) {
    await db.collectionProduct.deleteMany({ where: { collectionId: id } });
    for (const pid of b.productIds) await db.collectionProduct.create({ data: { collectionId: id, productId: Number(pid) } }).catch(() => {});
  }
  const c = await db.collection.update({ where: { id }, data: { title: b.title, subtitle: b.subtitle || null, image: b.image || null } });
  return NextResponse.json({ ok: true, collection: c });
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  await db.collection.delete({ where: { id: Number(params.id) } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
