import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
/* Public: variant info for cart size/color switching. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const productId = Number(sp.get("productId"));
  const size = sp.get("size") || undefined;
  const color = sp.get("color") || undefined;
  if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
  const product = await db.product.findUnique({ where: { id: productId }, select: { price: true } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const variants = await db.productVariant.findMany({ where: { productId, stock: { gt: 0 } }, select: { id: true, size: true, color: true, price: true, stock: true } });
  const match = variants.find((v) => (!size || v.size === size) && (!color || v.color === color)) || null;
  return NextResponse.json({ match, options: variants.map((v) => v.size).filter(Boolean) });
}
