import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { logAudit } from "@/lib/auth";

async function syncCollection(productId: number, slug: string, want: boolean) {
  const col = await db.collection.findUnique({ where: { slug } });
  if (!col) return;
  const ex = await db.collectionProduct.findUnique({ where: { collectionId_productId: { collectionId: col.id, productId } } });
  if (want && !ex) await db.collectionProduct.create({ data: { collectionId: col.id, productId } });
  if (!want && ex) await db.collectionProduct.delete({ where: { collectionId_productId: { collectionId: col.id, productId } } }).catch(() => {});
}

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  // optional ?q= filter (used by the order item picker; plain listing when absent)
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const products = await db.product.findMany({
    where: q ? { OR: [{ title: { contains: q } }, { sku: { contains: q } }, { tags: { contains: q } }] } : undefined,
    include: { images: true, variants: true, category: true },
    orderBy: [{ position: "asc" }, { id: "desc" }],
    take: q ? 12 : undefined,
  });
  return NextResponse.json({ products });
}
export async function POST(req: Request) {
  // make sure newer columns (Product.soldCount etc.) exist before writing
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
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
        soldCount: b.soldCount === "" || b.soldCount == null ? null : Math.max(0, Number(b.soldCount)),
        status: b.status || "ACTIVE", featured: !!b.featured, tags: b.tags || null,
        sizeChartImage: b.sizeChartImage || null, badge: b.badge || null, isNew: !!b.isNew, isBestSeller: !!b.isBestSeller,
        categoryId: b.categoryId ? Number(b.categoryId) : null,
        images: { create: (b.images || []).map((u: string, i: number) => ({ url: u, position: i, alt: b.title })) },
        variants: { create: (b.variants || []).map((v: any) => ({ size: v.size || null, color: v.color || null, sku: v.sku || null, price: v.price ? Number(v.price) : null, stock: Number(v.stock) || 0 })) },
      },
      include: { images: true, variants: true },
    });
    // every new product goes into "new-arrivals" automatically (admin can remove it later from Catalog → ✏️ Edit)
    await syncCollection(product.id, "new-arrivals", true);
    await syncCollection(product.id, "best-sellers", !!b.isBestSeller);
    await logAudit(g.user.email, "PRODUCT_CREATED", `${product.title} (#${product.id})`);
    return NextResponse.json({ ok: true, product });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 }); }
}
