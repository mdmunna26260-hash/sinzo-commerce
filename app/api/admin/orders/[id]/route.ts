import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { notifyAdmin, emailCustomerStatus } from "@/lib/notify";
import { sendPushToPhones } from "@/lib/webpush";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  return NextResponse.json({ order });
}
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = Number(params.id);
  const before = await db.order.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data: any = {};
  if (b.status) data.status = b.status;
  if (b.paymentStatus) data.paymentStatus = b.paymentStatus;
  if (b.adminNote !== undefined) data.adminNote = b.adminNote;
  if (b.name) data.name = b.name;
  if (b.phone) data.phone = b.phone;
  if (b.address) data.address = b.address;
  const order = await db.order.update({ where: { id }, data });
  if (b.status && b.status !== before.status) {
    await logAudit(g.user.email, "ORDER_STATUS", `${before.code}: ${before.status} → ${b.status}`);
    const evtMap: Record<string, any> = { CONFIRMED: "order.confirmed", CANCELLED: "order.cancelled", SHIPPED: "order.shipped", DELIVERED: "order.delivered" };
    const evt = evtMap[b.status];
    if (evt) {
      const emoji: Record<string, string> = { CONFIRMED: "✅", CANCELLED: "❌", SHIPPED: "🚚", DELIVERED: "📬" };
      notifyAdmin(evt, `${emoji[b.status] || "•"} Order ${before.code} → ${b.status}`, `${before.name} · ৳${Math.round(before.total).toLocaleString("en-IN")}`, before.code).catch(() => {});
    }
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
  // restock on cancel/return
  if (["CANCELLED", "RETURNED"].includes(b.status) && !["CANCELLED", "RETURNED"].includes(before.status)) {
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
