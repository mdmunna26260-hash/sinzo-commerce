import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { composeMessage, searchCatalog, productCardText } from "@/lib/wa-messages";
import { getSettings, envFallback } from "@/lib/settings";
import { siteUrl, waRules, textLength } from "@/lib/wa-queue";

export const dynamic = "force-dynamic";

/* Live preview for the composer: the same code path that builds the real message renders the text,
   so the bubble on screen is the bubble the customer gets.
   GET  ?q=panjabi           → product picker results
   POST { body, productId, couponCode, includeStopLine } → { body, images, chars } */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const q = new URL(req.url).searchParams.get("q") || "";
  const products = await searchCatalog(q, 12);
  return NextResponse.json({ ok: true, products });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({} as any));
  const s = envFallback(await getSettings());
  const rules = waRules(s);

  const composed = await composeMessage({
    body: b.body,
    productId: b.productId ? Number(b.productId) : null,
    couponCode: b.couponCode === undefined ? rules.couponCode : String(b.couponCode || ""),
    includeStopLine: typeof b.includeStopLine === "boolean" ? b.includeStopLine : rules.stopLine,
    images: [],
  });

  return NextResponse.json({
    ok: true,
    body: composed.body,
    product: composed.product || null,
    card: composed.product ? productCardText(composed.product, siteUrl(s)) : "",
    images: composed.images,
    chars: textLength(composed.body),
    limit: 4000,
    // a rough Banglish reading time — WhatsApp shows ~3 characters per second in practice
    parts: 1 + Math.floor(textLength(composed.body) / 1000),
  });
}
