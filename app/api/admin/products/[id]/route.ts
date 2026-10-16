import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { parseProductInput, ProductInputError } from "@/lib/product-input";

async function syncCollection(productId: number, slug: string, want: boolean) {
  const col = await db.collection.findUnique({ where: { slug } });
  if (!col) return;
  const ex = await db.collectionProduct.findUnique({ where: { collectionId_productId: { collectionId: col.id, productId } } });
  if (want && !ex) await db.collectionProduct.create({ data: { collectionId: col.id, productId } });
  if (!want && ex) await db.collectionProduct.delete({ where: { collectionId_productId: { collectionId: col.id, productId } } }).catch(() => {});
}

function productId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, props: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const params = await props.params;
  const id = productId(params.id);
  if (!id) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  const product = await db.product.findUnique({ where: { id }, include: { images: true, variants: true } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PUT(req: Request, props: Ctx) {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const params = await props.params;
  const id = productId(params.id);
  if (!id) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  try {
    const input = parseProductInput(await req.json().catch(() => null));
    const requestedSlug = slugify(input.slug || input.title);
    if (!requestedSlug) throw new ProductInputError("Title or slug must contain letters or numbers");
    const clash = await db.product.findFirst({ where: { slug: requestedSlug, id: { not: id } }, select: { id: true } });
    const finalSlug = clash ? requestedSlug + "-" + Date.now().toString(36) : requestedSlug;

    const before = await db.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, include: { images: true, variants: true } });
      if (!current) throw new ProductInputError("Product not found");
      const ownVariantIds = new Set(current.variants.map((variant) => variant.id));
      for (const variant of input.variants) {
        if (variant.id && !ownVariantIds.has(variant.id)) throw new ProductInputError("A variant does not belong to this product");
      }

      await tx.product.update({
        where: { id },
        data: {
          title: input.title,
          slug: finalSlug,
          shortDesc: input.shortDesc,
          description: input.description,
          sku: input.sku,
          barcode: input.barcode,
          price: input.price,
          comparePrice: input.comparePrice,
          cost: input.cost,
          stock: input.stock,
          lowStock: input.lowStock,
          soldCount: input.soldCount,
          saleEnds: input.saleEnds,
          preorder: input.preorder,
          preorderDate: input.preorderDate,
          soldMode: input.soldMode,
          colorGroupId: input.colorGroupId,
          colorName: input.colorName,
          colorImage: input.colorImage,
          status: input.status,
          featured: input.featured,
          tags: input.tags,
          sizeChartImage: input.sizeChartImage,
          badge: input.badge,
          isNew: input.isNew,
          isBestSeller: input.isBestSeller,
          categoryId: input.categoryId,
        },
      });

      if (input.stock !== current.stock) {
        await tx.inventoryMovement.create({ data: { productId: id, delta: input.stock - current.stock, reason: "ADJUST", ref: g.user.email } });
      }

      const imageIds = new Map(current.images.map((image) => [image.url, image.id]));
      await tx.productImage.deleteMany({ where: { productId: id, url: { notIn: input.images } } });
      for (let position = 0; position < input.images.length; position++) {
        const url = input.images[position];
        const imageId = imageIds.get(url);
        if (imageId) await tx.productImage.update({ where: { id: imageId }, data: { position, alt: input.title } });
        else await tx.productImage.create({ data: { url, position, productId: id, alt: input.title } });
      }

      const keepIds = input.variants.flatMap((variant) => variant.id ? [variant.id] : []);
      await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keepIds } } });
      for (const variant of input.variants) {
        const data = { size: variant.size, color: variant.color, sku: variant.sku, price: variant.price, stock: variant.stock, image: variant.image };
        if (variant.id) await tx.productVariant.update({ where: { id: variant.id }, data });
        else await tx.productVariant.create({ data: { ...data, productId: id } });
      }
      return current;
    });

    await syncCollection(id, "new-arrivals", input.isNew);
    await syncCollection(id, "best-sellers", input.isBestSeller);
    await logAudit(g.user.email, "PRODUCT_UPDATED", `${input.title} (#${id}) price: ${before.price} → ${input.price}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof ProductInputError) {
      const status = e.message === "Product not found" ? 404 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("product update failed", e);
    return NextResponse.json({ error: "Could not update the product. Please check the fields and try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const params = await props.params;
  const id = productId(params.id);
  if (!id) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  try {
    const product = await db.product.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const orderCount = await db.orderItem.count({ where: { productId: id } });
    if (orderCount > 0) {
      await db.$transaction([
        db.collectionProduct.deleteMany({ where: { productId: id } }),
        db.product.update({ where: { id }, data: { status: "ARCHIVED", featured: false, isNew: false, isBestSeller: false } }),
      ]);
      await logAudit(g.user.email, "PRODUCT_ARCHIVED", `${product.title} (#${id}); retained for ${orderCount} order item(s)`);
      return NextResponse.json({ ok: true, archived: true, message: "Product has order history, so it was archived instead of permanently deleted." });
    }
    await db.product.delete({ where: { id } });
    await logAudit(g.user.email, "PRODUCT_DELETED", `${product.title} (#${id})`);
    return NextResponse.json({ ok: true, archived: false });
  } catch (e) {
    console.error("product delete failed", e);
    return NextResponse.json({ error: "Could not delete the product." }, { status: 500 });
  }
}
