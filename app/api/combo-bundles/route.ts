import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* Public, read-only list of active combo bundles so the cart/checkout can show the
   bundle savings client-side (server remains authoritative at order time). */
export async function GET() {
  try {
    const bundles = await db.comboBundle.findMany({
      where: { active: true },
      orderBy: { position: "asc" },
      include: { items: { select: { productId: true } } },
    });
    return NextResponse.json({
      bundles: bundles.map((b) => ({ id: b.id, title: b.title, price: b.price, productIds: b.items.map((i) => i.productId) })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ bundles: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
