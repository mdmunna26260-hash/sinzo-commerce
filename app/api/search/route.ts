import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
// thumbs render at ~40px — the 300px variant is plenty (saves ~90% of image bytes)
const small = (url: string | null) => {
  if (!url) return null;
  if (url.includes("/uploads/seed/")) return url.replace(/\.jpg$/, "-300.webp");
  const m = url.match(/^\/api\/media\/([a-z0-9]+)$/i);
  return m ? `/api/media/${m[1]}/w300` : url;
};
const pick = (p: any) => ({ id: p.id, title: p.title, slug: p.slug, image: small(p.images?.[0]?.url || null), price: p.price });
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    const popular = await db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { views: "desc" }, take: 6, select: { id: true, title: true, slug: true, price: true, images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } } });
    return NextResponse.json({ products: popular.map(pick), popular: true });
  }
  const products = await db.product.findMany({
    where: { status: "ACTIVE", OR: [{ title: { contains: q } }, { tags: { contains: q } }, { sku: { contains: q } }, { shortDesc: { contains: q } }, { description: { contains: q } }] },
    select: { id: true, title: true, slug: true, price: true, images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } },
    take: 8, orderBy: { views: "desc" },
  });
  return NextResponse.json({ products: products.map(pick), popular: false });
}
