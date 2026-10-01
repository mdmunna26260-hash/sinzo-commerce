import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { ensureExtraTables } from "@/lib/db-ensure";
import { getSettings } from "@/lib/settings";
import { verifyRecovery, prepareRecoveredCart, RecoveryError } from "@/lib/abandoned-cart";
import { CheckoutValidationError } from "@/lib/checkout-items";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };

// Only a signed, expiring, contact-bound bearer can read a saved guest checkout.
// The URL fragment is posted in the body, never used as an enumerable ID lookup.
export async function POST(req: Request) {
  try {
    if (!rateLimit("cart-recover:" + getClientIp(req), 30, 10 * 60 * 1000)) return NextResponse.json({ error: "Please try again later" }, { status: 429, headers });
    const body = await req.json().catch(() => null);
    await ensureExtraTables();
    const { row, couponCode } = await verifyRecovery(db, body?.token);
    const settings = await getSettings(true);
    const result = await prepareRecoveredCart(db, row, settings, couponCode);
    const pricing = { shipping: { insideDhaka: settings.shipping?.insideDhaka, outsideDhaka: settings.shipping?.outsideDhaka, freeShippingThreshold: settings.shipping?.freeShippingThreshold }, checkout: { codEnabled: settings.checkout?.codEnabled, giftWrapFee: settings.checkout?.giftWrapFee } };
    return NextResponse.json({ ok: true, ...result, pricing }, { headers });
  } catch (e: any) {
    if (e instanceof CheckoutValidationError) return NextResponse.json({ error: e.message }, { status: e instanceof RecoveryError ? e.status : 400, headers });
    console.error("Cart recovery failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not recover this cart. Please try again." }, { status: 500, headers });
  }
}
