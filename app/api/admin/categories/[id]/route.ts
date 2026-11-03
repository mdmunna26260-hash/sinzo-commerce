import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { categoryLevel, MAX_CATEGORY_DEPTH } from "@/lib/category-tree";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  const b = await req.json();
  // Partial update: only touch fields the client actually sent, so an
  // image-only upload can't wipe description/sizeChart (or name).
  const data: any = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.description !== undefined) data.description = b.description || null;
  if (b.image !== undefined) data.image = b.image || null;
  if (b.sizeChart !== undefined) data.sizeChart = b.sizeChart || null;
  if (b.slug) data.slug = slugify(b.slug);
  if (b.parentId !== undefined) {
    const parentId = b.parentId ? Number(b.parentId) : null;
    // validate: exists, not self/descendant (no cycles), max 3 levels deep
    if (parentId !== null) {
      const parent = await db.category.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: "Parent category not found" }, { status: 400 });
      if (parentId === id) return NextResponse.json({ error: "A category cannot be its own parent" }, { status: 400 });
      const all = await db.category.findMany({ select: { id: true, parentId: true } });
      let cur: number | null = parentId;
      const seen = new Set<number>();
      while (cur !== null) {
        if (cur === id) return NextResponse.json({ error: "Cannot move a category under its own descendant" }, { status: 400 });
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = all.find((c) => c.id === cur)?.parentId ?? null;
      }
      if (categoryLevel(all, parentId) >= MAX_CATEGORY_DEPTH) {
        return NextResponse.json({ error: `Maximum ${MAX_CATEGORY_DEPTH} levels allowed (main → sub → child)` }, { status: 400 });
      }
    }
    data.parentId = parentId;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  try {
    const c = await db.category.update({ where: { id }, data });
    return NextResponse.json({ ok: true, category: c });
  } catch {
    return NextResponse.json({ error: "Update failed (slug may already be in use)" }, { status: 400 });
  }
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  // children are re-homed to main (FK ON DELETE SET NULL); products lose the link
  // (Product.category is an optional relation → SetNull). Never deletes products.
  await db.category.delete({ where: { id: Number(params.id) } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
