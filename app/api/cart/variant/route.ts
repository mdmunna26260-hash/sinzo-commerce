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
  /* stock: 0 rows are included on purpose — the quick-add popover must be able to show a size as
     sold out (like the PDP does) instead of pretending it never existed. */
  const variants = await db.productVariant.findMany({ where: { productId }, select: { id: true, size: true, color: true, price: true, stock: true } });
  const match = variants.find((v) => (!size || v.size === size) && (!color || v.color === color) && v.stock > 0) || null;
  return NextResponse.json({
    match,
    /* one entry per size — a product with 2 colours would otherwise list every size twice
       in the cart page's size switcher (pre-existing, the old query had the same shape) */
    options: Array.from(new Set(variants.filter((v) => v.stock > 0).map((v) => v.size).filter(Boolean))) as string[],
    variants,
  });
}
