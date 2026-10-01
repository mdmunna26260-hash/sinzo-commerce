import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { validateCoupon, CouponValidationError } from "@/lib/coupons";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || typeof body.code !== "string" || typeof body.subtotal !== "number" || !Number.isFinite(body.subtotal) || body.subtotal < 0) {
      return NextResponse.json({ valid: false, error: "Invalid coupon request" }, { status: 400 });
    }
    const phone = body.phone ? normalizeBDPhone(String(body.phone)) : undefined;
    if (phone && !isValidBDPhone(phone)) return NextResponse.json({ valid: false, error: "Enter a valid BD mobile number" }, { status: 400 });
    const coupon = await db.coupon.findUnique({ where: { code: body.code.toUpperCase().trim() } });
    const result = await validateCoupon(db, coupon, body.subtotal, phone);
    return NextResponse.json({ valid: true, ...result });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e instanceof CouponValidationError ? e.message : "Invalid coupon request" }, { status: e instanceof CouponValidationError ? 200 : 400 });
  }
}
