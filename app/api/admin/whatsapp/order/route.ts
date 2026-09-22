import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { orderContext } from "@/lib/wa-messages";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* Order context for the inbox / composer.
   GET ?orderId=12 · ?code=ORD-1012 · ?wa=8801XXXXXXXXX  → the order, its items, every event
   template with the body ALREADY rendered for this order (so "send the shipped update" is one
   click, and what the owner sees in the preview is exactly what the customer receives). */
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const url = new URL(req.url);
  const orderId = Number(url.searchParams.get("orderId")) || undefined;
  const code = url.searchParams.get("code") || undefined;
  const waId = url.searchParams.get("wa") || undefined;
  const event = url.searchParams.get("event") || undefined;

  const ctx = await orderContext({ orderId, code, waId, event });
  if (!ctx) return NextResponse.json({ ok: false, error: "Kono order paoa gelo na" }, { status: 404 });

  // the last messages we sent this number, so the owner does not repeat themselves
  const recent = await db.waMessage.findMany({
    where: { toWaId: String(ctx.order.waId).replace(/\D/g, "") },
    orderBy: { id: "desc" }, take: 5,
    select: { id: true, templateKey: true, status: true, sentAt: true, body: true },
  }).catch(() => []);

  return NextResponse.json({ ok: true, ...ctx, recent });
}
