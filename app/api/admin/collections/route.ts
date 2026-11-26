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
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Title is too long" }, { status: 400 });
  const productIds = [...new Set<number>((Array.isArray(b.productIds) ? b.productIds : [])
    .map((id: unknown) => Number(typeof id === "string" ? id.trim() : id))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (productIds.length) {
    const known = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true } });
    const knownIds = new Set(known.map((p) => p.id));
    const missing = productIds.filter((pid) => !knownIds.has(pid));
    if (missing.length) return NextResponse.json({ error: `Unknown product id(s): ${missing.slice(0, 10).join(", ")}` }, { status: 400 });
  }
  try {
    const baseSlug = slugify(b.slug || title);
    const slug = baseSlug || `collection-${Date.now().toString(36)}`;
    // Collection.slug is @unique: the old code let that surface as a bare 500
    const clash = await db.collection.findUnique({ where: { slug }, select: { id: true } });
    const finalSlug = clash ? `${slug}-${Date.now().toString(36)}`.slice(0, 120) : slug;
    const c = await db.collection.create({
      data: {
        title,
        slug: finalSlug,
        subtitle: b.subtitle ? String(b.subtitle).slice(0, 500) : null,
        image: b.image ? String(b.image).slice(0, 2048) : null,
        products: productIds.length ? { create: productIds.map((productId) => ({ productId })) } : undefined,
      },
    });
    return NextResponse.json({ ok: true, collection: c });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "That slug is already in use" }, { status: 409 });
    console.error("collection create failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not create the collection" }, { status: 500 });
  }
}
