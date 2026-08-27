import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ coupons: await db.coupon.findMany({ orderBy: { id: "desc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.code) return NextResponse.json({ error: "Code required" }, { status: 400 });
  try {
    const c = await db.coupon.create({ data: {
      code: String(b.code).toUpperCase().trim(), type: b.type || "percent", value: Number(b.value) || 0,
      minOrder: b.minOrder ? Number(b.minOrder) : null, maxDiscount: b.maxDiscount ? Number(b.maxDiscount) : null,
      usageLimit: b.usageLimit ? Number(b.usageLimit) : null, perCustomer: b.perCustomer ? Number(b.perCustomer) : null,
      firstOrderOnly: !!b.firstOrderOnly, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null,
      active: b.active !== false,
    }});
    return NextResponse.json({ ok: true, coupon: c });
  } catch (e: any) { return NextResponse.json({ error: "Code already exists" }, { status: 400 }); }
}
