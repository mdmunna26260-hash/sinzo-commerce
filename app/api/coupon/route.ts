import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { code, subtotal, phone } = await req.json();
    const c = await db.coupon.findUnique({ where: { code: String(code || "").toUpperCase().trim() } });
    if (!c || !c.active) return NextResponse.json({ valid: false, error: "Invalid coupon code" });
    const now = new Date();
    if (c.startsAt && now < c.startsAt) return NextResponse.json({ valid: false, error: "Coupon not active yet" });
    if (c.endsAt && now > c.endsAt) return NextResponse.json({ valid: false, error: "Coupon expired" });
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) return NextResponse.json({ valid: false, error: "Coupon usage limit reached" });
    if (c.minOrder != null && subtotal < c.minOrder) return NextResponse.json({ valid: false, error: `Minimum order ৳${c.minOrder} required` });
    if (c.firstOrderOnly && phone) {
      const prior = await db.order.count({ where: { phone, status: { notIn: ["CANCELLED"] } } });
      if (prior > 0) return NextResponse.json({ valid: false, error: "Coupon valid on first order only" });
    }
    if (c.perCustomer != null && phone) {
      const used = await db.order.count({ where: { phone, couponCode: c.code, status: { notIn: ["CANCELLED"] } } });
      if (used >= c.perCustomer) return NextResponse.json({ valid: false, error: "You have already used this coupon" });
    }
    let discount = 0;
    if (c.type === "percent") discount = Math.round(((subtotal * c.value) / 100) * 100) / 100;
    else if (c.type === "fixed") discount = c.value;
    if (c.maxDiscount != null && discount > c.maxDiscount) discount = c.maxDiscount;
    return NextResponse.json({ valid: true, code: c.code, type: c.type, discount, freeship: c.type === "freeship" });
  } catch { return NextResponse.json({ valid: false, error: "Server error" }, { status: 400 }); }
}
