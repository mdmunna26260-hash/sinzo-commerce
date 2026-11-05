import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { normalizeGiftRule, giftEntitlement } from "@/lib/gift";

export const dynamic = "force-dynamic";

/* Public free-gift rule + eligible gift pool for the cart/checkout picker.
   Server re-validates everything at order time — this is display/UX only. */
export async function GET() {
  try {
    const s = await getSettings(true);
    const rule = normalizeGiftRule(s.gift);
    if (!rule.enabled || !rule.tiers.length || !rule.productIds.length) {
      return NextResponse.json({ enabled: false, tiers: [], pool: [], excludeProductIds: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const pool = await db.product.findMany({
      where: { id: { in: rule.productIds }, status: "ACTIVE" },
      select: {
        id: true, title: true, slug: true, price: true,
        images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
        variants: { select: { id: true, size: true, color: true, stock: true, price: true } },
      },
    });
    return NextResponse.json({
      enabled: true,
      tiers: rule.tiers,
      excludeProductIds: rule.excludeProductIds,
      pool: pool.map((p) => ({
        id: p.id, title: p.title, slug: p.slug, price: p.price, image: p.images[0]?.url || null,
        variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, price: v.price })),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ enabled: false, tiers: [], pool: [], excludeProductIds: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
}

/* Helper for the client: how many free gifts does this subtotal unlock. */
export function giftQtyFor(subtotal: number, tiers: unknown) {
  return giftEntitlement(subtotal, { enabled: true, tiers });
}
