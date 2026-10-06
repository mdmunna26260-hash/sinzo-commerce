import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { getSettings } from "@/lib/settings";
import { ensureExtraTables } from "@/lib/db-ensure";
import { captureKeyHash } from "@/lib/recovery-security";
import { validateRecoveryContact, cartMetadata, cartProducts, RecoveryError, lockAbandoned } from "@/lib/abandoned-cart";
import { parseCheckoutLines, buildCheckoutItems, CheckoutValidationError } from "@/lib/checkout-items";
import { checkoutTotals } from "@/lib/checkout-pricing";
import { validateCoupon, CouponValidationError } from "@/lib/coupons";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  try {
    if (!rateLimit("checkout-start:" + getClientIp(req), 30, 10 * 60 * 1000)) return NextResponse.json({ error: "Please wait before updating checkout again" }, { status: 429, headers });
    const body = await req.json().catch(() => null);
    const key = captureKeyHash(body?.captureKey);
    if (!key || !Number.isInteger(body?.revision) || body.revision < 1 || body.revision > 1_000_000_000) throw new RecoveryError("Invalid checkout session");
    const contact = validateRecoveryContact(body);
    const metadata = cartMetadata(body);
    const lines = parseCheckoutLines(body.items);
    await ensureExtraTables();
    const products = await cartProducts(db, lines);
    // A draft may contain wanted stock that has since sold out. Its IDs and
    // current DB prices still have to be real; orders always check stock.
    const quote = buildCheckoutItems(lines, products, { checkStock: false });
    const settings = await getSettings(true);
    let applied = null;
    if (metadata.couponCode) {
      try { applied = await validateCoupon(db, await db.coupon.findUnique({ where: { code: metadata.couponCode } }), quote.subtotal, contact.phone); }
      catch (e) { if (!(e instanceof CouponValidationError)) throw e; }
    }
    const totals = checkoutTotals({ subtotal: quote.subtotal, discount: applied?.discount, freeship: applied?.freeship, area: metadata.area, shipping: settings.shipping });
    const cartJson = JSON.stringify({ version: 2, ...metadata, items: quote.items });
    const result = await db.$transaction(async tx => {
      // Insert a private browser-owned identity once, then serialize updates.
      const draft = await tx.abandonedCheckout.upsert({ where: { captureKeyHash: key }, create: { captureKeyHash: key, cartJson, total: totals.total, ...contact }, update: {} });
      await lockAbandoned(tx, draft.id);
      const current = await tx.abandonedCheckout.findUniqueOrThrow({ where: { id: draft.id } });
      if (current.checkoutStatus !== "OPEN") return { closed: true };
      if (current.captureRevision >= body.revision) return { stale: true };
      await tx.abandonedCheckout.update({ where: { id: current.id }, data: { ...contact, cartJson, total: totals.total, captureRevision: body.revision, updatedAt: new Date() } });
      return { saved: true };
    }, { maxWait: 10_000, timeout: 15_000 });
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (e: any) {
    if (e instanceof CheckoutValidationError) return NextResponse.json({ error: e.message }, { status: e instanceof RecoveryError ? e.status : 400, headers });
    if (["P2002", "P2034"].includes(e?.code)) return NextResponse.json({ error: "Checkout changed; please retry" }, { status: 409, headers });
    console.error("Checkout capture failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not save checkout" }, { status: 500, headers });
  }
}
