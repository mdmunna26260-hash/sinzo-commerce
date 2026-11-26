import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { logAudit } from "@/lib/auth";
import { productSearchWhere } from "@/lib/search";
import { parseProductInput, ProductInputError, assertProductRefs } from "@/lib/product-input";

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
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const products = await db.product.findMany({
    where: q ? { AND: [productSearchWhere(q, ["title", "sku", "tags"])] } : undefined,
    include: { images: true, variants: true, category: true },
    orderBy: [{ position: "asc" }, { id: "desc" }],
    take: q ? 12 : undefined,
  });
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const input = parseProductInput(await req.json().catch(() => null));
    const slug = slugify(input.slug || input.title);
    if (!slug) throw new ProductInputError("Title or slug must contain letters or numbers");
    const exists = await db.product.findUnique({ where: { slug } });
    const finalSlug = exists ? slug + "-" + Date.now().toString(36) : slug;
    // a deleted or hand-typed category used to surface as a Prisma FK error (bare 500)
    await assertProductRefs(input, (table, refId) => (table === "category"
      ? db.category.findUnique({ where: { id: refId }, select: { id: true } })
      : db.colorGroup.findUnique({ where: { id: refId }, select: { id: true } })).then((row) => !!row));
    const product = await db.product.create({
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
        comboEligible: input.comboEligible,
        outsideDeliveryFee: input.outsideDeliveryFee == null ? null : Number(input.outsideDeliveryFee),
        comboOffers: input.comboOffers,
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
        images: { create: input.images.map((url, position) => ({ url, position, alt: input.title })) },
        variants: { create: input.variants.map((variant) => ({
          size: variant.size,
          color: variant.color,
          sku: variant.sku,
          price: variant.price,
          stock: variant.stock,
          image: variant.image,
        })) },
      },
      include: { images: true, variants: true },
    });
    // POST used to always add the product to "new-arrivals" regardless of the
    // isNew checkbox (only PUT respected it) — every new product landed in the
    // New Arrivals collection, including ones explicitly left unticked.
    await syncCollection(product.id, "new-arrivals", input.isNew);
    await syncCollection(product.id, "best-sellers", input.isBestSeller);
    await logAudit(g.user.email, "PRODUCT_CREATED", `${product.title} (#${product.id})`);
    return NextResponse.json({ ok: true, product });
  } catch (e: any) {
    if (e instanceof ProductInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("product create failed", e);
    return NextResponse.json({ error: "Could not create the product. Please check the fields and try again." }, { status: 500 });
  }
}
