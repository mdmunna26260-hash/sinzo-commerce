import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { ensureExtraTables } = await import("@/lib/db-ensure");
    await ensureExtraTables().catch(() => {});
    const { productId, rating, name, phone, text, photos } = await req.json();
    // anti-spam: a handful of reviews per IP / per phone, not unlimited
    const ip = getClientIp(req);
    if (!rateLimit("review:" + ip, 5, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many reviews from your connection. Try again later." }, { status: 429 });
    }
    if (phone && !rateLimit("review-ph:" + String(phone).replace(/[^0-9]/g, ""), 3, 24 * 60 * 60 * 1000)) {
      return NextResponse.json({ error: "You have reviewed enough today. Thank you!" }, { status: 429 });
    }
    if (!productId || !name || !text) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    const r = Math.max(1, Math.min(5, parseInt(rating) || 5));
    // review photos: max 3, only our own media URLs (uploaded via /api/reviews/upload)
    const safePhotos = Array.isArray(photos)
      ? photos.filter((u: any) => typeof u === "string" && /^\/api\/media\/[a-z0-9]+$/i.test(u)).slice(0, 3)
      : [];
    // verified purchase: phone has an order containing this product
    let verified = false;
    if (phone) {
      const orders = await db.order.findMany({ where: { phone: phone.replace(/[\s-]/g, ""), status: "DELIVERED" }, include: { items: true }, take: 20 });
      verified = orders.some((o) => o.items.some((i) => i.productId === productId));
    }
    await db.review.create({ data: { productId: Number(productId), name: String(name).slice(0, 60), phone: phone ? String(phone).slice(0, 20) : null, rating: r, text: String(text).slice(0, 2000), verified, photos: safePhotos.length ? JSON.stringify(safePhotos) : null } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
