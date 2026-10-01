import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { getSettings } from "@/lib/settings";
import { storeUrl } from "@/lib/notify";
import { ensureExtraTables } from "@/lib/db-ensure";
import { signRecoveryToken, recoveryUrl } from "@/lib/recovery-security";
import { readSavedCart } from "@/lib/abandoned-cart";
export const dynamic = "force-dynamic";
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  const id = Number((await props.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid checkout" }, { status: 400 });
  await ensureExtraTables();
  const row = await db.abandonedCheckout.findUnique({ where: { id } });
  if (!row || row.checkoutStatus !== "OPEN" || row.convertedOrderId) return NextResponse.json({ error: "This checkout is no longer open" }, { status: 410 });
  try { readSavedCart(row.cartJson); } catch { return NextResponse.json({ error: "Older checkout: ask the customer to rebuild their cart" }, { status: 400 }); }
  const s = await getSettings(true);
  const coupon = typeof s.marketing?.recoveryCoupon === "string" ? s.marketing.recoveryCoupon : undefined;
  return NextResponse.json({ ok: true, url: recoveryUrl(storeUrl(s), signRecoveryToken(row, coupon)) }, { headers: { "Cache-Control": "private, no-store" } });
}
