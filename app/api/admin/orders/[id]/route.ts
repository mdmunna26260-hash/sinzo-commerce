import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { notifyAdmin, emailCustomerStatus } from "@/lib/notify";
import { sendPushToPhones } from "@/lib/webpush";
import { applyDeliveryStockDeduction, stockWasDeducted } from "@/lib/deliver-stock";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  return NextResponse.json({ order });
}
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = Number(params.id);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const before = await db.order.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data: any = {};
  if (b.status) data.status = b.status;
  if (b.paymentStatus) data.paymentStatus = b.paymentStatus;
  if (b.adminNote !== undefined) data.adminNote = b.adminNote;
  if (b.name) data.name = b.name;
  if (b.phone) data.phone = b.phone;
  if (b.address) data.address = b.address;

  /* ---- ITEM EDITING (admin): replace the whole item list ----
     b.items = [{ id? (existing OrderItem id), productId, variantId?, price, qty }]
     - removed rows   → stock restored (+ inventoryMovement)
     - changed qty    → stock delta adjusted
     - new rows       → product validated, stock guarded (400 if not enough)
     - subtotal recomputed; deliveryFee kept (or b.deliveryFee);
       grand total = b.total override ?? (subtotal − discount + deliveryFee)
     Runs in a transaction — any failure rolls everything back. */
  let itemsEdited = false;
  if (Array.isArray(b.items)) {
    itemsEdited = true;
    const incoming = b.items as any[];
    if (incoming.length === 0) return NextResponse.json({ error: "Order must have at least one item" }, { status: 400 });
    const existingItems = await db.orderItem.findMany({ where: { orderId: id } });
    const byId = new Map(existingItems.map((i) => [i.id, i]));
    const keepIds = new Set<number>();
    const ops: any[] = [];

    for (const it of incoming) {
      const qty = Math.max(1, Math.min(Number(it.qty) || 1, 999));
      const price = Math.max(0, Number(it.price) || 0);
      if (it.id && byId.has(Number(it.id))) {
        const eid = byId.get(Number(it.id))!;
        keepIds.add(eid.id);
        ops.push({ type: "update", id: eid.id, price, qty, oldQty: eid.qty, title: eid.title, productId: eid.productId, variantId: eid.variantId });
      } else {
        if (!it.productId) return NextResponse.json({ error: "New item rows need a productId" }, { status: 400 });
        const prod = await db.product.findUnique({
          where: { id: Number(it.productId) },
          include: { images: { orderBy: { position: "asc" }, take: 1 }, variants: true },
        });
        if (!prod || prod.status === "ARCHIVED") return NextResponse.json({ error: "Product not found (id " + it.productId + ")" }, { status: 400 });
        const variant = it.variantId ? prod.variants.find((v) => v.id === Number(it.variantId)) ?? null : null;
        ops.push({
          type: "create", productId: prod.id, variantId: variant?.id ?? null, title: prod.title,
          variantLabel: variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : null,
          price, qty, image: prod.images?.[0]?.url || null,
        });
      }
    }
    const removed = existingItems.filter((i) => !keepIds.has(i.id));

    try {
      await db.$transaction(async (tx) => {
        for (const r of removed) {
          await tx.orderItem.delete({ where: { id: r.id } });
          if (r.productId) {
            await tx.product.update({ where: { id: r.productId }, data: { stock: { increment: r.qty } } });
            if (r.variantId) await tx.productVariant.update({ where: { id: r.variantId }, data: { stock: { increment: r.qty } } });
            await tx.inventoryMovement.create({ data: { productId: r.productId, delta: r.qty, reason: "MANUAL", ref: before.code } });
          }
        }
        for (const op of ops) {
          if (op.type === "update") {
            await tx.orderItem.update({ where: { id: op.id }, data: { price: op.price, qty: op.qty } });
            const delta = op.qty - op.oldQty;
            if (delta !== 0 && op.productId) {
              // stock guard for increases (same rule as new items)
              if (delta > 0) {
                if (op.variantId) {
                  const v = await tx.productVariant.findUnique({ where: { id: op.variantId }, select: { stock: true } });
                  if (!v || v.stock < delta) throw new Error(`Not enough stock for ${op.title}${op.variantLabel ? " (" + op.variantLabel + ")" : ""} — stock: ${v?.stock ?? 0}`);
                } else {
                  const pr = await tx.product.findUnique({ where: { id: op.productId }, select: { stock: true } });
                  if (!pr || pr.stock < delta) throw new Error(`Not enough stock for ${op.title} — stock: ${pr?.stock ?? 0}`);
                }
              }
              await tx.product.update({ where: { id: op.productId }, data: { stock: { decrement: delta } } });
              if (op.variantId) await tx.productVariant.update({ where: { id: op.variantId }, data: { stock: { decrement: delta } } });
              await tx.inventoryMovement.create({ data: { productId: op.productId, delta: -delta, reason: "MANUAL", ref: before.code } });
            }
          } else {
            if (op.variantId) {
              const v = await tx.productVariant.findUnique({ where: { id: op.variantId }, select: { stock: true } });
              if (!v || v.stock < op.qty) throw new Error(`Not enough stock for ${op.title}${op.variantLabel ? " (" + op.variantLabel + ")" : ""} — stock: ${v?.stock ?? 0}`);
              await tx.productVariant.update({ where: { id: op.variantId }, data: { stock: { decrement: op.qty } } });
            } else {
              const pr = await tx.product.findUnique({ where: { id: op.productId }, select: { stock: true } });
              if (!pr || pr.stock < op.qty) throw new Error(`Not enough stock for ${op.title} — stock: ${pr?.stock ?? 0}`);
            }
            await tx.product.update({ where: { id: op.productId }, data: { stock: { decrement: op.qty } } });
            await tx.orderItem.create({ data: { orderId: id, productId: op.productId, variantId: op.variantId, title: op.title, variant: op.variantLabel, price: op.price, qty: op.qty, image: op.image } });
            await tx.inventoryMovement.create({ data: { productId: op.productId, delta: -op.qty, reason: "MANUAL", ref: before.code } });
          }
        }
        const newSubtotal = ops.reduce((s, o) => s + o.price * o.qty, 0);
        const newDelivery = b.deliveryFee != null && b.deliveryFee !== "" ? Math.max(0, Number(b.deliveryFee)) : before.deliveryFee;
        const newTotal = b.total != null && b.total !== "" ? Math.max(0, Number(b.total)) : Math.max(0, newSubtotal - (before.discount || 0) + newDelivery);
        await tx.order.update({ where: { id }, data: { subtotal: newSubtotal, deliveryFee: newDelivery, total: newTotal } });
        await tx.auditLog.create({ data: { userEmail: g.user.email, action: "ORDER_ITEMS_EDIT", detail: `${before.code}: ${existingItems.length}→${incoming.length} items · total ৳${Math.round(before.total)}→৳${Math.round(newTotal)}` } });
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Item update failed" }, { status: 400 });
    }
  }

  // total / delivery override without touching items
  if (!itemsEdited && b.total != null && b.total !== "") data.total = Math.max(0, Number(b.total) || 0);
  if (!itemsEdited && b.deliveryFee != null && b.deliveryFee !== "") data.deliveryFee = Math.max(0, Number(b.deliveryFee) || 0);

  const order = await db.order.update({ where: { id }, data });
  if (b.status && b.status !== before.status) {
    await logAudit(g.user.email, "ORDER_STATUS", `${before.code}: ${before.status} → ${b.status}`);
    // Stock: manual delivery triggers the one-time decrement (same as Steadfast sync)
    if (b.status === "DELIVERED") {
      await applyDeliveryStockDeduction(id, before.code).catch(() => {});
      // points + the post-delivery review ask (idempotent, see lib/on-delivered.ts)
      const { onOrderDelivered } = await import("@/lib/on-delivered");
      await onOrderDelivered(id).catch(() => {});
    }
    const evtMap: Record<string, any> = { CONFIRMED: "order.confirmed", CANCELLED: "order.cancelled", SHIPPED: "order.shipped", DELIVERED: "order.delivered" };
    const evt = evtMap[b.status];
    if (evt) {
      const emoji: Record<string, string> = { CONFIRMED: "✅", CANCELLED: "❌", SHIPPED: "🚚", DELIVERED: "📬" };
      notifyAdmin(evt, `${emoji[b.status] || "•"} Order ${before.code} → ${b.status}`, `${before.name} · ৳${Math.round(before.total).toLocaleString("en-IN")}`, before.code).catch(() => {});
    }
    // customer WhatsApp for this transition (queued — the worker paces it; dedupeKey stops repeats)
    await import("@/lib/wa-queue").then(async ({ eventForStatus, enqueueOrderEvent }) => {
      const ev = eventForStatus(b.status);
      if (ev) await enqueueOrderEvent(id, ev);
    }).catch(() => {});
    // customer SMS (Settings → Notifications → SMS → per-status switches)
    import("@/lib/sms").then(async ({ autoSmsOnStatus }) => {
      const { getSettings, envFallback } = await import("@/lib/settings");
      await autoSmsOnStatus(envFallback(await getSettings()), b.status, before);
    }).catch(() => {});
    // customer cancellation email (only on transition INTO cancelled)
    if (b.status === "CANCELLED" && before.email) {
      emailCustomerStatus(before.email, before.name, { code: before.code, total: before.total, area: before.area, courierName: before.courierName }, "cancelled").catch(() => {});
    }
    // web push to the customer's devices (order updates)
    const pushMap: Record<string, { t: string; b: string }> = {
      CONFIRMED: { t: "Order confirmed ✓", b: `Apnar order ${before.code} confirm hoyeche. Shighroi dispatch hobe.` },
      SHIPPED: { t: "Parcel shipped", b: `Order ${before.code} courier-te pathano hoyeche. Track korun.` },
      DELIVERED: { t: "Delivered", b: `Order ${before.code} deliver hoyeche. Dhonnobad!` },
      CANCELLED: { t: "Order cancelled", b: `Order ${before.code} cancel kora hoyeche.` },
    };
    const pm = pushMap[b.status];
    if (pm) {
      sendPushToPhones([before.phone], { title: pm.t, body: pm.b, url: `/track?code=${before.code}`, tag: before.code }).catch(() => {});
    }
  }
  // restock on cancel/return — ONLY if stock was actually deducted.
  // New flow: stock is never taken at order time, so a plain cancellation
  // must NOT restock (it would inflate stock). Restock applies to:
  //   - delivered-then-returned orders (stock was deducted at delivery),
  //   - legacy pre-rollout orders (stock was deducted at old checkout,
  //     detected via their "ORDER" inventory movement).
  if (["CANCELLED", "RETURNED"].includes(b.status) && !["CANCELLED", "RETURNED"].includes(before.status) && (before.stockDeducted || (await stockWasDeducted(id, before.code)))) {
    const items = await db.orderItem.findMany({ where: { orderId: id } });
    for (const i of items) {
      if (i.productId) {
        await db.product.update({ where: { id: i.productId }, data: { stock: { increment: i.qty } } }).catch(() => {});
        // exact variant restock (variantId persisted on new orders)
        if (i.variantId) {
          await db.productVariant.update({ where: { id: i.variantId }, data: { stock: { increment: i.qty } } }).catch(() => {});
        }
        await db.inventoryMovement.create({ data: { productId: i.productId, delta: i.qty, reason: b.status === "CANCELLED" ? "CANCEL" : "RETURN", ref: before.code } }).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true, order });
}
