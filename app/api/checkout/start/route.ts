import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
/* Abandoned-checkout capture. Dedup: one OPEN row per 30 min window. */
export async function POST(req: Request) {
  try {
    const { items, total, phone, name, address } = await req.json();
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await db.abandonedCheckout.findFirst({
      where: { checkoutStatus: "OPEN", updatedAt: { gte: since }, ...(phone ? { phone: String(phone) } : { phone: null }) },
      orderBy: { id: "desc" },
    });
    if (recent) {
      await db.abandonedCheckout.update({
        where: { id: recent.id },
        data: {
          cartJson: JSON.stringify(items || []), total: Number(total) || 0, updatedAt: new Date(),
          ...(phone ? { phone: String(phone) } : {}), ...(name ? { name: String(name) } : {}), ...(address ? { address: String(address) } : {}),
        },
      });
      return NextResponse.json({ ok: true, updated: true });
    }
    await db.abandonedCheckout.create({
      data: {
        cartJson: JSON.stringify(items || []), total: Number(total) || 0,
        phone: phone ? String(phone) : null, name: name ? String(name) : null, address: address ? String(address) : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false }, { status: 200 }); }
}
