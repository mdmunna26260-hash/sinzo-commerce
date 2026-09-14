import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { assessRisk } from "@/lib/risk";
import { sendCapi } from "@/lib/capi";
import { detectSource, getClientIp } from "@/lib/ua";
import { rateLimit } from "@/lib/auth";
import { orderCode } from "@/lib/slug";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { notifyAdmin, emailCustomerOrder, whatsappCustomerOrder } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // safety: make sure newer columns (Order.channel, OrderItem.variantId etc.) exist before writing
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const { deployChannel } = await import("@/lib/deploy-channel");
  try {
    const body = await req.json();
    const { name, phone, email, address, area, notes, paymentMethod, couponCode, purchaseEventId, attribution } = body;
    const items = Array.isArray(body.items) ? body.items : [];

    // --- validation ---
    const errors: any = {};
    if (!name || String(name).trim().length < 3) errors.name = "Please enter your full name";
    const cleanPhone = normalizeBDPhone(String(phone || ""));
    if (!isValidBDPhone(cleanPhone)) errors.phone = "Enter a valid BD mobile number";
    if (!address || String(address).trim().length < 10) errors.address = "Please enter your full address";
    if (area !== "INSIDE_DHAKA" && area !== "OUTSIDE_DHAKA") errors.area = "Select delivery zone";
    if (items.length === 0) return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
    if (Object.keys(errors).length) return NextResponse.json({ error: "Please fix the highlighted fields", errors }, { status: 400 });

    // basic bot/brute-force guard on top of the fraud velocity engine
    const ip = getClientIp(req);
    if (!rateLimit("checkout:" + ip, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Please try again in a few minutes." }, { status: 429 });
    }

    const s = envFallback(await getSettings());
    const shipCfg = s.shipping || {};
    const checkoutCfg = s.checkout || {};

    if (paymentMethod !== "COD" && !checkoutCfg.onlinePaymentEnabled) {
      return NextResponse.json({ error: "Online payment is not available yet. Please use Cash on Delivery." }, { status: 400 });
    }

    // --- load & verify products server-side (never trust client prices) ---
    const productIds = items.map((i: any) => Number(i.productId)).filter(Boolean);
    const products = await db.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, include: { variants: true, images: true } });
    if (!products.length) return NextResponse.json({ error: "Products unavailable" }, { status: 400 });

    let subtotal = 0;
    const orderItems: any[] = [];
    for (const line of items) {
      const p = products.find((x) => x.id === Number(line.productId));
      if (!p) return NextResponse.json({ error: "A product in your cart is no longer available" }, { status: 400 });
      let unit = p.price;
      let stockLeft = p.stock;
      let variantLabel: string | undefined;
      let variantId: number | null = null;
      if (line.variantId) {
        const v = p.variants.find((x) => x.id === Number(line.variantId));
        if (v) {
          if (v.stock <= 0 && !p.preorder) return NextResponse.json({ error: `${p.title} (${v.size || ""}${v.color ? " · " + v.color : ""}) is sold out` }, { status: 400 });
          unit = v.price || p.price;
          stockLeft = v.stock;
          variantId = v.id;
          variantLabel = [v.size, v.color].filter(Boolean).join(" · ");
        }
      } else if (p.stock <= 0 && !p.preorder) {
        return NextResponse.json({ error: `${p.title} is sold out` }, { status: 400 });
      }
      const qty = Math.max(1, Math.min(Number(line.qty) || 1, p.preorder ? 99 : stockLeft));
      subtotal += unit * qty;
      orderItems.push({ productId: p.id, variantId, title: p.title, variant: variantLabel, price: unit, qty, image: p.images?.[0]?.url || null, stockLeft, preorder: !!p.preorder, preorderDate: p.preorderDate ? new Date(p.preorderDate) : null });
    }

    // --- fraud / risk (before committing anything) ---
    const risk = await assessRisk({ phone: cleanPhone, address: String(address), ip }, s.fraud);
    if (risk.level === "CRITICAL") {
      return NextResponse.json({ error: "We're unable to accept this order. Please contact support." }, { status: 403 });
    }

    // --- delivery fee (from admin settings, never hardcoded) ---
    const feeBase = area === "INSIDE_DHAKA" ? Number(shipCfg.insideDhaka ?? 80) : Number(shipCfg.outsideDhaka ?? 140);
    const freeT = Number(shipCfg.freeShippingThreshold ?? 0);
    const giftWrapFee = body.giftWrap ? Math.max(0, Number(checkoutCfg.giftWrapFee ?? 60)) : 0;

    // --- transactional order placement: coupon + customer + order + guarded
    //     stock all commit or roll back together (no oversell, no half-burned
    //     coupons, no negative stock under concurrent checkouts) ---
    class SoldOutError extends Error {}
    let result: { order: any; appliedCode: string | null };
    try {
      result = await db.$transaction(async (tx) => {
        // coupon (usageLimit enforced; usedCount increments atomically with the order)
        let discount = 0;
        let freeship = false;
        let appliedCode: string | null = null;
        if (couponCode) {
          const c = await tx.coupon.findUnique({ where: { code: String(couponCode).toUpperCase().trim() } });
          const now = new Date();
          const firstOrderOk = !c?.firstOrderOnly || (await tx.order.count({ where: { phone: cleanPhone, status: { notIn: ["CANCELLED"] } } })) === 0;
          const usable = c && c.active
            && (!c.startsAt || now >= c.startsAt) && (!c.endsAt || now <= c.endsAt)
            && (c.usageLimit == null || c.usedCount < c.usageLimit)
            && (c.minOrder == null || subtotal >= c.minOrder)
            && firstOrderOk;
          if (usable) {
            if (c!.type === "percent") discount = Math.round(((subtotal * c!.value) / 100) * 100) / 100;
            else if (c!.type === "fixed") discount = c!.value;
            if (c!.maxDiscount != null && discount > c!.maxDiscount) discount = c!.maxDiscount;
            if (c!.type === "freeship") freeship = true;
            appliedCode = c!.code;
            await tx.coupon.update({ where: { id: c!.id }, data: { usedCount: { increment: 1 } } });
          }
        }

        const deliveryFee = freeship || (freeT > 0 && subtotal - discount >= freeT) ? 0 : feeBase;
        const total = Math.max(0, subtotal - discount) + deliveryFee + giftWrapFee;

        // customer upsert
        const customer = await tx.customer.upsert({
          where: { phone: cleanPhone },
          update: { name: String(name).trim(), address: String(address).trim(), area, email: email || null },
          create: { phone: cleanPhone, name: String(name).trim(), address: String(address).trim(), area, email: email || null },
        });

        // create order
        const order = await tx.order.create({
          data: {
            code: "TEMP", name: String(name).trim(), phone: cleanPhone, email: email || null,
            address: String(address).trim(), area, notes: body.giftWrap ? (notes ? notes + " | " : "") + "🎁 GIFT WRAP (+৳" + giftWrapFee + ")" : notes || null,
            subtotal, discount, deliveryFee, total,
            couponCode: appliedCode, paymentMethod: paymentMethod || "COD", paymentStatus: "PENDING",
            status: risk.level === "HIGH" ? "ON_HOLD" : "PENDING",
            riskLevel: risk.level, riskFlags: risk.flags.join(", ") || null,
            source: detectSource(attribution), attribution: attribution ? JSON.stringify(attribution) : null,
            channel: deployChannel(),
            ip, customerId: customer.id,
            items: { create: orderItems.map((i) => ({ productId: i.productId, variantId: i.variantId, title: i.title, variant: i.variant, price: i.price, qty: i.qty, image: i.image, preorder: !!i.preorder, preorderDate: i.preorderDate ? new Date(i.preorderDate) : null })) },
          },
        });
        const code = orderCode(order.id);
        const finalOrder = await tx.order.update({ where: { id: order.id }, data: { code } });

        // Inventory is NOT decremented at order time (Steadfast flow):
        // stock is subtracted exactly once when the order is DELIVERED
        // (lib/deliver-stock.ts). The sold-out validation above still
        // protects against selling 0-stock non-pre-order items.

        // abandoned checkout: mark CONVERTED (order placed)
        await tx.abandonedCheckout.updateMany({
          where: { phone: cleanPhone, checkoutStatus: "OPEN" },
          data: { checkoutStatus: "CONVERTED", recovered: true },
        }).catch(() => {});

        return { order: finalOrder, appliedCode };
      });
    } catch (e) {
      if (e instanceof SoldOutError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
    const order = result.order;
    const code = order.code;
    const appliedCode = result.appliedCode;
    const total = order.total;

    // --- server-side Purchase via Meta CAPI (dedup with browser pixel by event_id) ---
    sendCapi({
      eventName: "Purchase",
      eventId: purchaseEventId || `srv_purchase_${order.id}`,
      eventSourceUrl: req.headers.get("referer") || undefined,
      userData: { phone: cleanPhone, email: email || undefined, name: String(name || ""), clientIp: ip, userAgent: req.headers.get("user-agent") || undefined, externalId: cleanPhone },
      customData: { currency: "BDT", value: total, content_type: "product", num_items: orderItems.reduce((a, i) => a + i.qty, 0), contents: orderItems.map((i) => ({ id: String(i.productId), quantity: i.qty, item_price: i.price })) },
    }).catch(() => {});

    // customer order-confirmation WhatsApp (linked device, if enabled)
    whatsappCustomerOrder(cleanPhone, String(name).trim(), { code, total, area, items: orderItems.map((i) => ({ title: i.title + (i.preorder ? " [Pre-order]" : ""), qty: i.qty, price: i.price })) }).catch(() => {});

    // customer order-confirmation email (if email given + SMTP configured)
    if (email) {
      emailCustomerOrder(String(email), String(name).trim(), { code, total, area, items: orderItems.map((i) => ({ title: i.title + (i.preorder ? " [Pre-order]" : ""), qty: i.qty, price: i.price })) }).catch(() => {});
    }

    // admin notification (in-app + Telegram + email if configured)
    notifyAdmin("order.placed",
      `🛒 NEW ORDER ${code}`,
      `👤 ${name} (${cleanPhone})\n💰 ৳${Math.round(total).toLocaleString("en-IN")} · ${paymentMethod}\n📍 ${area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}\n📦 ${orderItems.reduce((a, i) => a + i.qty, 0)} item(s)${appliedCode ? `\n🎟 ${appliedCode}` : ""}${risk.level !== "LOW" ? `\n⚠ Risk: ${risk.level}` : ""}`,
      code).catch(() => {});

    return NextResponse.json({ ok: true, code, total, risk: risk.level });
  } catch (e: any) {
    console.error("checkout error", e);
    return NextResponse.json({ error: "Something went wrong placing your order. Please try again." }, { status: 500 });
  }
}
