import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
/* Abandoned-checkout capture. Dedup: one OPEN row per 30 min window. */
export async function POST(req: Request) {
  try {
    // PII-capture endpoint: keep it bounded per IP
    if (!rateLimit("checkout-start:" + getClientIp(req), 5, 60 * 60 * 1000)) return NextResponse.json({ ok: false, skipped: "rate" });
    const { items, total, phone, name, address, email } = await req.json();
    // Only capture as "abandoned" when the customer actually filled the checkout form
    if (!phone || !name || !address) return NextResponse.json({ ok: false, skipped: "incomplete" });
    const safeEmail = email && /.+@.+\..+/.test(String(email)) ? String(email).trim().slice(0, 120) : null;
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
          ...(safeEmail ? { email: safeEmail } : {}),
        },
      });
      return NextResponse.json({ ok: true, updated: true });
    }
    await db.abandonedCheckout.create({
      data: {
        cartJson: JSON.stringify(items || []), total: Number(total) || 0,
        phone: phone ? String(phone) : null, name: name ? String(name) : null, address: address ? String(address) : null,
        email: safeEmail,
      },
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false }, { status: 200 }); }
}
