import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import ProductsClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

export default async function AdminProducts(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "products");
  // make sure newer columns (Product.soldCount etc.) exist before querying
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const products = await db.product.findMany({ include: { images: true, variants: true, category: true }, orderBy: [{ position: "asc" }, { id: "desc" }] });
  const categories = await db.category.findMany({ orderBy: { name: "asc" } });
  const data = products.map((p) => ({
    id: p.id, title: p.title, slug: p.slug, sku: p.sku, price: p.price, comparePrice: p.comparePrice,
    cost: p.cost, stock: p.stock, lowStock: p.lowStock, status: p.status, featured: p.featured,
    tags: p.tags, shortDesc: p.shortDesc, description: p.description,
    sizeChartImage: p.sizeChartImage || null, badge: p.badge, isNew: p.isNew, isBestSeller: p.isBestSeller,
    soldCount: p.soldCount, saleEnds: p.saleEnds,
    preorder: !!p.preorder, preorderDate: p.preorderDate ? p.preorderDate.toISOString() : null,
    soldMode: p.soldMode || "fixed",
    colorGroupId: p.colorGroupId, colorName: p.colorName, colorImage: p.colorImage,
    position: p.position,
    categoryId: p.categoryId, categoryName: p.category?.name, views: p.views,
    image: p.images?.[0]?.url || null,
    images: p.images.sort((a, b) => a.position - b.position).map((i) => i.url),
    variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, sku: v.sku, price: v.price, stock: v.stock, image: v.image })),
  }));
  return <ProductsClient initial={data} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />;
}
