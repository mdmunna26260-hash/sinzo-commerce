import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { productId, rating, name, phone, text } = await req.json();
    if (!productId || !name || !text) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    const r = Math.max(1, Math.min(5, parseInt(rating) || 5));
    // verified purchase: phone has an order containing this product
    let verified = false;
    if (phone) {
      const orders = await db.order.findMany({ where: { phone: phone.replace(/[\s-]/g, ""), status: "DELIVERED" }, include: { items: true }, take: 20 });
      verified = orders.some((o) => o.items.some((i) => i.productId === productId));
    }
    await db.review.create({ data: { productId: Number(productId), name: String(name).slice(0, 60), phone: phone ? String(phone).slice(0, 20) : null, rating: r, text: String(text).slice(0, 2000), verified } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
