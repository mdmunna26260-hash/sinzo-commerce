import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { categoryLevel, MAX_CATEGORY_DEPTH } from "@/lib/category-tree";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ categories: await db.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: "asc" } }) });
}

/* Validate a parentId for a category: must exist, max 3 levels (main → sub → child),
   and (on update) must not create a cycle. Returns an error message or null. */
async function validateParent(parentId: number | null | undefined, selfId?: number): Promise<string | null> {
  if (parentId === null || parentId === undefined) return null; // main category
  const parent = await db.category.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!parent) return "Parent category not found";
  if (selfId !== undefined && parentId === selfId) return "A category cannot be its own parent";
  const all = await db.category.findMany({ select: { id: true, parentId: true } });
  if (selfId !== undefined) {
    // cycle check: walk up from the proposed parent; must never reach selfId
    let cur: number | null = parentId;
    const seen = new Set<number>();
    while (cur !== null && cur !== undefined) {
      if (cur === selfId) return "Cannot move a category under its own descendant";
      if (seen.has(cur)) return "Category tree is corrupted (cycle detected)";
      seen.add(cur);
      cur = all.find((c) => c.id === cur)?.parentId ?? null;
    }
  }
  const parentLevel = categoryLevel(all, parentId);
  if (parentLevel >= MAX_CATEGORY_DEPTH) return `Maximum ${MAX_CATEGORY_DEPTH} levels allowed (main → sub → child) — "${parentId}" is already a child category`;
  return null;
}

export async function POST(req: Request) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const parentId = b.parentId ? Number(b.parentId) : null;
  const perr = await validateParent(parentId);
  if (perr) return NextResponse.json({ error: perr }, { status: 400 });
  try {
    const c = await db.category.create({ data: { name: b.name, slug: slugify(b.slug || b.name), description: b.description || null, image: b.image || null, sizeChart: b.sizeChart || null, parentId } });
    return NextResponse.json({ ok: true, category: c });
  } catch {
    return NextResponse.json({ error: "Create failed (slug may already be in use)" }, { status: 400 });
  }
}
