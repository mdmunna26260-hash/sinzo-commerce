import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, props: Ctx) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });

  try {
    const source = await db.product.findUnique({
      where: { id },
      include: { images: { orderBy: { position: "asc" } }, variants: true },
    });
    if (!source) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const maxPosition = await db.product.aggregate({ _max: { position: true } });
    const suffix = Date.now().toString(36);
    const title = `${source.title} Copy`.slice(0, 200);
    const product = await db.product.create({
      data: {
        title,
        slug: `${source.slug.slice(0, Math.max(1, 114 - suffix.length))}-copy-${suffix}`,
        shortDesc: source.shortDesc,
        description: source.description,
        sku: source.sku ? `${source.sku}-COPY-${suffix.toUpperCase()}`.slice(0, 120) : null,
        barcode: null,
        price: source.price,
        comparePrice: source.comparePrice,
        cost: source.cost,
        stock: 0,
        lowStock: source.lowStock,
        status: "DRAFT",
        featured: false,
        tags: source.tags,
        position: (maxPosition._max.position || 0) + 1,
        sizeChartImage: source.sizeChartImage,
        soldCount: null,
        saleEnds: null,
        preorder: source.preorder,
        preorderDate: source.preorderDate,
        soldMode: source.soldMode,
        badge: null,
        isNew: false,
        isBestSeller: false,
        colorGroupId: source.colorGroupId,
        colorName: source.colorName,
        colorImage: source.colorImage,
        categoryId: source.categoryId,
        images: { create: source.images.map((image, position) => ({ url: image.url, alt: title, position })) },
        variants: { create: source.variants.map((variant) => ({
          size: variant.size,
          color: variant.color,
          sku: variant.sku ? `${variant.sku}-COPY-${suffix.toUpperCase()}`.slice(0, 120) : null,
          price: variant.price,
          stock: 0,
          barcode: null,
          image: variant.image,
        })) },
      },
      include: { images: true, variants: true },
    });
    await logAudit(g.user.email, "PRODUCT_DUPLICATED", `${source.title} (#${source.id}) → ${product.title} (#${product.id})`);
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    console.error("product duplicate failed", error);
    return NextResponse.json({ error: "Could not duplicate the product." }, { status: 500 });
  }
}
