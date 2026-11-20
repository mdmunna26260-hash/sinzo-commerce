import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/* Meta (Facebook/Instagram) product catalog feed for Advantage+ / Dynamic Ads.
   URL: https://<site>/feed.xml — add this in Meta Commerce Manager as the catalog
   data source (scheduled fetch). Only ACTIVE products are listed; stock is the
   sum of product + variant stock (a product is in_stock if any variant has stock
   or it is a pre-order). */

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function GET() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const s = await getSettings();
  const brand = s.store?.name || "SINZO";
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, title: true, slug: true, shortDesc: true, description: true, price: true, comparePrice: true,
      stock: true, preorder: true,
      images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
      variants: { select: { stock: true } },
    },
    orderBy: [{ position: "asc" }, { id: "desc" }],
  });

  const items = products.map((p) => {
    const stock = Math.max(p.stock, p.variants.reduce((sum, v) => sum + (v.stock || 0), 0));
    const inStock = p.preorder || stock > 0;
    const img = p.images[0]?.url || "";
    const imageLink = img.startsWith("http") ? img : `${base}${img.startsWith("/") ? "" : "/"}${img}`;
    const link = `${base}/products/${p.slug}`;
    const price = `${Number(p.price).toFixed(2)} BDT`;
    return `    <item>
      <id>${p.id}</id>
      <title>${esc(p.title)}</title>
      <description>${esc(p.shortDesc || p.description || p.title)}</description>
      <availability>${inStock ? "in stock" : "out of stock"}</availability>
      <condition>new</condition>
      <price>${price}</price>
      <link>${esc(link)}</link>
      <image_link>${esc(imageLink)}</image_link>
      <brand>${esc(brand)}</brand>
      <google_product_category>Apparel &amp; Accessories</google_product_category>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${esc(brand)} Product Catalog</title>
    <link>${esc(base)}</link>
    <description>${esc(brand)} product feed for Meta Advantage+ / Dynamic Ads</description>
${items.join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
