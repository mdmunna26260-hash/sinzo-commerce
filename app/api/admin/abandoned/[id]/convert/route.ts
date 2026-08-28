import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { orderCode } from "@/lib/slug";
import { getSettings, envFallback } from "@/lib/settings";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };

/* Convert an abandoned checkout into a real order (admin-assisted recovery).
   Creates the order using the captured cart + customer info, then marks the row CONVERTED. */
export async function POST(req: Request, { params }: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  try {
    const a = await db.abandonedCheckout.findUnique({ where: { id: Number(params.id) } });
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (a.checkoutStatus === "CONVERTED" || !a.phone || !a.name || !a.address) {
      return NextResponse.json({ error: "Phone/Name/Address chara order bana jabe na" }, { status: 400 });
    }
    const cart = JSON.parse(a.cartJson || "[]");
    if (!cart.length) return NextResponse.json({ error: "Cart khali" }, { status: 400 });

    const s = envFallback(await getSettings());
    const area = a.address.toLowerCase().includes("dhaka") ? "INSIDE_DHAKA" : "OUTSIDE_DHAKA";
    const subtotal = Number(a.total) || cart.reduce((x: number, i: any) => x + (i.price || 0) * (i.qty || 1), 0);
    const feeBase = area === "INSIDE_DHAKA" ? Number(s.shipping?.insideDhaka ?? 80) : Number(s.shipping?.outsideDhaka ?? 140);
    const freeT = Number(s.shipping?.freeShippingThreshold ?? 0);
    const deliveryFee = freeT > 0 && subtotal >= freeT ? 0 : feeBase;
    const total = subtotal + deliveryFee;

    const customer = await db.customer.upsert({
      where: { phone: a.phone! },
      update: { name: a.name!, address: a.address! },
      create: { phone: a.phone!, name: a.name!, address: a.address!, area },
    });

    const order = await db.order.create({
      data: {
        code: "TEMP", name: a.name!, phone: a.phone!, address: a.address!, area,
        subtotal, deliveryFee, total, status: "CONFIRMED", paymentStatus: "PENDING",
        paymentMethod: "COD", source: "Recovered",
        customerId: customer.id, adminNote: "Recovered from abandoned checkout #" + a.id,
        items: { create: cart.map((i: any) => ({ title: i.title, price: i.price || 0, qty: i.qty || 1, image: i.image || null })) },
      },
      include: { items: true },
    });
    const code = orderCode(order.id);
    await db.order.update({ where: { id: order.id }, data: { code } });
    await db.abandonedCheckout.update({ where: { id: a.id }, data: { checkoutStatus: "CONVERTED", recovered: true } });
    await logAudit(g.user.email, "ABANDONED_CONVERTED", `${a.id} → ${code}`);
    notifyAdmin("order.placed", `♻️ RECOVERED ORDER ${code}`, `👤 ${a.name} (${a.phone})\n💰 ৳${Math.round(total)} (from abandoned checkout)`, code).catch(() => {});
    return NextResponse.json({ ok: true, code, orderId: order.id });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 }); }
}
