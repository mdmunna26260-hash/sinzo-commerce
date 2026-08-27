import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ categories: await db.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: "asc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const c = await db.category.create({ data: { name: b.name, slug: slugify(b.slug || b.name), description: b.description || null, image: b.image || null, sizeChart: b.sizeChart || null } });
  return NextResponse.json({ ok: true, category: c });
}
