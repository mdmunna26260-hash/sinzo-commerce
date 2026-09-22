import { MetadataRoute } from "next";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const [products, categories, collections, posts] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ select: { slug: true } }),
    db.collection.findMany({ select: { slug: true } }),
    db.blogPost.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: base + "/products", changeFrequency: "daily", priority: 0.9 },
    { url: base + "/track", priority: 0.5, changeFrequency: "monthly" as const },
    // the returns/exchange + delivery policy — the same page the PDP's MerchantReturnPolicy
    // points at with merchantReturnLink, so Google and the customer read one document
    { url: base + "/returns", priority: 0.4, changeFrequency: "monthly" as const },
    // Category FILTER urls were removed: /products?category=x renders the same grid as
    // /products (and unknown slugs used to render ALL products), so they only created
    // duplicate pages that compete with /products and with /collections/<slug>.
    ...collections.map((c) => ({ url: `${base}/collections/${c.slug}`, priority: 0.7, changeFrequency: "weekly" as const })),
    ...products.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, priority: 0.8 })),
    /* the journal: guides are worth indexing (they answer the questions people search for),
       but only once published — a draft URL must never enter the sitemap */
    ...(posts.length ? [{ url: base + "/blog", priority: 0.5, changeFrequency: "weekly" as const }] : []),
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, priority: 0.5 })),
  ];
}
