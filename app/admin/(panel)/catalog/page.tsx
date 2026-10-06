import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import CatalogClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Catalog" };
export default async function CatalogPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, ["categories", "collections"]);
  const [categories, collections, products] = await Promise.all([
    db.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: "asc" } }),
    db.collection.findMany({ include: { products: { include: { product: { select: { title: true } } } }, _count: { select: { products: true } } }, orderBy: { id: "asc" } }),
    db.product.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  return <CatalogClient
    categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, image: c.image, productCount: c._count?.products ?? 0 }))}
    collections={collections.map((c) => ({ id: c.id, title: c.title, slug: c.slug, subtitle: c.subtitle, productCount: c._count?.products ?? c.products?.length ?? 0, productIds: (c.products || []).map((x) => x.productId) }))}
    products={products}
  />;
}
