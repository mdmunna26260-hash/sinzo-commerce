import { MetadataRoute } from "next";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const [products, categories, collections] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ select: { slug: true } }),
    db.collection.findMany({ select: { slug: true } }),
  ]);
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: base + "/products", changeFrequency: "daily", priority: 0.9 },
    { url: base + "/track", priority: 0.5 },
    ...categories.map((c) => ({ url: `${base}/products?category=${c.slug}`, priority: 0.7 })),
    ...collections.map((c) => ({ url: `${base}/collections/${c.slug}`, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, priority: 0.8 })),
  ];
}
