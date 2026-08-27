import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const products = await db.product.findMany({ include: { images: true, variants: true, category: true }, orderBy: [{ position: "asc" }, { id: "desc" }] });
  return NextResponse.json({ products });
}
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    if (!b.title || b.price == null) return NextResponse.json({ error: "Title and price are required" }, { status: 400 });
    const slug = b.slug ? slugify(b.slug) : slugify(b.title);
    const exists = await db.product.findUnique({ where: { slug } });
    const finalSlug = exists ? slug + "-" + Date.now().toString(36) : slug;
    const product = await db.product.create({
      data: {
        title: b.title, slug: finalSlug, shortDesc: b.shortDesc || null, description: b.description || null,
        sku: b.sku || null, barcode: b.barcode || null,
        price: Number(b.price) || 0, comparePrice: b.comparePrice ? Number(b.comparePrice) : null,
        cost: b.cost ? Number(b.cost) : null, stock: Number(b.stock) || 0, lowStock: Number(b.lowStock) || 5,
        status: b.status || "ACTIVE", featured: !!b.featured, tags: b.tags || null,
        categoryId: b.categoryId ? Number(b.categoryId) : null,
        images: { create: (b.images || []).map((u: string, i: number) => ({ url: u, position: i, alt: b.title })) },
        variants: { create: (b.variants || []).map((v: any) => ({ size: v.size || null, color: v.color || null, sku: v.sku || null, price: v.price ? Number(v.price) : null, stock: Number(v.stock) || 0 })) },
      },
      include: { images: true, variants: true },
    });
    await logAudit(g.user.email, "PRODUCT_CREATED", `${product.title} (#${product.id})`);
    return NextResponse.json({ ok: true, product });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 }); }
}
