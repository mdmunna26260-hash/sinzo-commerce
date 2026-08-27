import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ collections: await db.collection.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: "asc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  const c = await db.collection.create({ data: { title: b.title, slug: slugify(b.slug || b.title), subtitle: b.subtitle || null, image: b.image || null, products: { create: (b.productIds || []).map((id: number) => ({ productId: Number(id) })) } } });
  return NextResponse.json({ ok: true, collection: c });
}
