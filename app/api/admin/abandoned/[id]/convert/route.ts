import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { orderCode } from "@/lib/slug";
import { getSettings } from "@/lib/settings";
import { notifyAdmin } from "@/lib/notify";
import { ensureExtraTables } from "@/lib/db-ensure";
import { quoteSavedCart, validateRecoveryContact, lockAbandoned, RecoveryError } from "@/lib/abandoned-cart";
import { CheckoutValidationError } from "@/lib/checkout-items";
import { CouponValidationError } from "@/lib/coupons";
import { deployChannel } from "@/lib/deploy-channel";
import { assessRisk } from "@/lib/risk";
export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const marketing = await requirePerm("marketing", req); if ("res" in marketing) return marketing.res;
  const g = await requirePerm("orders", req); if ("res" in g) return g.res;
  const id = Number((await props.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid checkout" }, { status: 400 });
  try {
    await ensureExtraTables();
    const original = await db.abandonedCheckout.findUnique({ where: { id } });
    if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const contact = validateRecoveryContact(original);
    const s = await getSettings(true);
    if (s.checkout?.codEnabled === false) throw new RecoveryError("Cash on Delivery is disabled");
    const risk = await assessRisk({ phone: contact.phone, address: contact.address, ip: "admin-recovery" }, s.fraud);
    if (risk.level === "CRITICAL") throw new RecoveryError("This order is blocked by fraud rules", 403);
    const coupon = typeof s.marketing?.recoveryCoupon === "string" ? s.marketing.recoveryCoupon.trim().toUpperCase() : null;
    if (new URL(req.url).searchParams.get("preview") === "1") {
      if (original.checkoutStatus === "CONVERTED") throw new RecoveryError("Already converted", 409);
      const quote = await quoteSavedCart(db, original, s, coupon);
      return NextResponse.json({ ok: true, ...quote.totals, area: quote.saved.area });
    }
    const body = await req.json().catch(() => ({}));
    const result = await db.$transaction(async tx => {
      await tx.customer.upsert({ where: { phone: contact.phone }, update: { phone: contact.phone }, create: { ...contact, area: "INSIDE_DHAKA" } });
      await lockAbandoned(tx, id);
      const row = await tx.abandonedCheckout.findUniqueOrThrow({ where: { id } });
      if (row.checkoutStatus === "CONVERTED") {
        const existing = row.convertedOrderId ? await tx.order.findUnique({ where: { id: row.convertedOrderId } }) : null;
        if (!existing) throw new RecoveryError("Already converted", 409);
        return { order: existing, reused: true };
      }
      if (row.phone !== original.phone) throw new RecoveryError("Contact changed; refresh this checkout", 409);
      const quote = await quoteSavedCart(tx, row, s, coupon, true);
      if (body?.expectedTotal !== undefined && body.expectedTotal !== quote.totals.total) throw new RecoveryError("Prices changed. Review the new order total before confirming.", 409);
      const customer = await tx.customer.update({ where: { phone: quote.contact.phone }, data: { ...quote.contact, area: quote.saved.area } });
      const order = await tx.order.create({ data: {
        code: "TEMP-" + crypto.randomUUID(), ...quote.contact, area: quote.saved.area,
        notes: quote.saved.notes || null,
        subtotal: quote.totals.subtotal, discount: quote.totals.discount, deliveryFee: quote.totals.deliveryFee, total: quote.totals.total,
        couponCode: quote.applied?.code || null, status: risk.level === "HIGH" ? "ON_HOLD" : "CONFIRMED", paymentStatus: "PENDING", paymentMethod: "COD",
        source: "Recovered", channel: deployChannel(), customerId: customer.id,
        riskLevel: risk.level, riskFlags: risk.flags.join(", ") || null,
        adminNote: "Recovered from abandoned checkout #" + row.id, items: { create: quote.items },
      } });
      const final = await tx.order.update({ where: { id: order.id }, data: { code: orderCode(order.id) } });
      // No stock reservation/deduction: the existing delivery-time policy remains.
      await tx.abandonedCheckout.updateMany({ where: { OR: [{ phone: quote.contact.phone }, { id: row.id }], checkoutStatus: { in: ["OPEN", "RECOVERED"] } }, data: { checkoutStatus: "CONVERTED", recovered: true, convertedOrderId: order.id } });
      return { order: final, reused: false };
    }, { maxWait: 10_000, timeout: 20_000 });
    if (!result.reused) {
      logAudit(g.user.email, "ABANDONED_CONVERTED", `${id} → ${result.order.code}`).catch(() => {});
      notifyAdmin("order.placed", `RECOVERED ORDER ${result.order.code}`, `Recovered checkout #${id} · ৳${result.order.total}`, result.order.code).catch(() => {});
      import("@/lib/wa-queue").then(({ enqueueOrderEvent }) => enqueueOrderEvent(result.order.id, "order_placed")).catch(() => {});
    }
    return NextResponse.json({ ok: true, code: result.order.code, orderId: result.order.id, total: result.order.total, reused: result.reused });
  } catch (e: any) {
    if (e instanceof CheckoutValidationError || e instanceof CouponValidationError) return NextResponse.json({ error: e.message }, { status: e instanceof RecoveryError ? e.status : 400 });
    if (e?.code === "P2034") return NextResponse.json({ error: "Checkout changed; please retry" }, { status: 409 });
    console.error("Recovery conversion failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not convert checkout" }, { status: 500 });
  }
}
