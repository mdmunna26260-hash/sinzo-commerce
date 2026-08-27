import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
const pick = (p: any) => ({ id: p.id, title: p.title, slug: p.slug, image: p.images?.[0]?.url || null, price: p.price });
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    const popular = await db.product.findMany({ where: { status: "ACTIVE" }, include: { images: true }, orderBy: { views: "desc" }, take: 6 });
    return NextResponse.json({ products: popular.map(pick), popular: true });
  }
  const products = await db.product.findMany({
    where: { status: "ACTIVE", OR: [{ title: { contains: q } }, { tags: { contains: q } }, { sku: { contains: q } }, { shortDesc: { contains: q } }, { description: { contains: q } }] },
    include: { images: true }, take: 8, orderBy: { views: "desc" },
  });
  return NextResponse.json({ products: products.map(pick), popular: false });
}
