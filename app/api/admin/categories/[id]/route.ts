import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const data: any = { name: b.name, description: b.description || null, image: b.image || null, sizeChart: b.sizeChart || null };
  if (b.slug) data.slug = slugify(b.slug);
  try {
    const c = await db.category.update({ where: { id: Number(params.id) }, data });
    return NextResponse.json({ ok: true, category: c });
  } catch {
    return NextResponse.json({ error: "Update failed (slug may already be in use)" }, { status: 400 });
  }
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  await db.category.delete({ where: { id: Number(params.id) } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
