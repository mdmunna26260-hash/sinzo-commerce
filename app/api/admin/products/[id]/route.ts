import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";

async function syncCollection(productId: number, slug: string, want: boolean) {
  const col = await db.collection.findUnique({ where: { slug } });
  if (!col) return;
  const ex = await db.collectionProduct.findUnique({ where: { collectionId_productId: { collectionId: col.id, productId } } });
  if (want && !ex) await db.collectionProduct.create({ data: { collectionId: col.id, productId } });
  if (!want && ex) await db.collectionProduct.delete({ where: { collectionId_productId: { collectionId: col.id, productId } } }).catch(() => {});
}
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const p = await db.product.findUnique({ where: { id: Number(params.id) }, include: { images: true, variants: true } });
  return NextResponse.json({ product: p });
}
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    const id = Number(params.id);
    const before = await db.product.findUnique({ where: { id }, include: { images: true } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data: any = {
      title: b.title, shortDesc: b.shortDesc || null, description: b.description || null,
      sku: b.sku || null, barcode: b.barcode || null,
      price: Number(b.price) || 0, comparePrice: b.comparePrice ? Number(b.comparePrice) : null,
      cost: b.cost ? Number(b.cost) : null, stock: Number(b.stock) || 0, lowStock: Number(b.lowStock) || 5,
      status: b.status || "ACTIVE", featured: !!b.featured, tags: b.tags || null,
      sizeChartImage: b.sizeChartImage || null, isNew: !!b.isNew, isBestSeller: !!b.isBestSeller,
      categoryId: b.categoryId ? Number(b.categoryId) : null,
    };
    if (b.slug) {
      const newSlug = slugify(b.slug);
      if (newSlug && newSlug !== before.slug) {
        const clash = await db.product.findFirst({ where: { slug: newSlug, id: { not: id } } });
        data.slug = clash ? newSlug + "-" + Date.now().toString(36) : newSlug;
      }
    }
    await db.product.update({ where: { id }, data });
    // sync images
    const urls: string[] = b.images || [];
    for (const img of before.images) if (!urls.includes(img.url)) await db.productImage.delete({ where: { id: img.id } });
    for (let i = 0; i < urls.length; i++) {
      const ex = before.images.find((im) => im.url === urls[i]);
      if (ex) await db.productImage.update({ where: { id: ex.id }, data: { position: i } });
      else await db.productImage.create({ data: { url: urls[i], position: i, productId: id, alt: b.title } });
    }
    // sync variants
    const vs: any[] = b.variants || [];
    const keepIds = vs.filter((v) => v.id).map((v) => Number(v.id));
    await db.productVariant.deleteMany({ where: { productId: id, id: { notIn: keepIds } } });
    for (const v of vs) {
      if (v.id) await db.productVariant.update({ where: { id: Number(v.id) }, data: { size: v.size || null, color: v.color || null, sku: v.sku || null, price: v.price ? Number(v.price) : null, stock: Number(v.stock) || 0 } });
      else await db.productVariant.create({ data: { productId: id, size: v.size || null, color: v.color || null, sku: v.sku || null, price: v.price ? Number(v.price) : null, stock: Number(v.stock) || 0 } });
    }
    await syncCollection(id, "new-arrivals", !!b.isNew);
    await syncCollection(id, "best-sellers", !!b.isBestSeller);
    await logAudit(g.user.email, "PRODUCT_UPDATED", `${b.title} (#${id}) price: ${before.price} → ${b.price}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 }); }
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  const p = await db.product.findUnique({ where: { id } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.product.delete({ where: { id } });
  await logAudit(g.user.email, "PRODUCT_DELETED", `${p.title} (#${id})`);
  return NextResponse.json({ ok: true });
}
