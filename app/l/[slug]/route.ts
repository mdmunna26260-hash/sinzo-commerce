import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logApp } from "@/lib/logs";

export const dynamic = "force-dynamic";

/* Short campaign links (/l/<slug>) — Phase 3 click tracking.

   A campaign puts `{link}` in its body, which renders to this URL, so the click counter is a real
   count of how many people opened the offer. The redirect itself must never break: an unknown or
   expired slug falls back to the storefront instead of a 404 page. */
export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const slug = String(params.slug || "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const link = slug ? await db.waLink.findUnique({ where: { slug } }).catch(() => null) : null;
  if (!link) {
    const base = process.env.NEXT_PUBLIC_SITE_URL || "/";
    return NextResponse.redirect(base.startsWith("http") ? base : new URL(base, req.url).toString(), 302);
  }

  await db.waLink
    .update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: new Date() } })
    .catch(() => {});
  // one log line per click is noisy for a big campaign — only the first few get logged
  if (link.clicks < 20) {
    await logApp("INFO", "WHATSAPP", `campaign link ${slug} clicked (${link.clicks + 1})`, { broadcastId: link.broadcastId }).catch(() => {});
  }

  const target = /^https?:\/\//.test(link.target) ? link.target : new URL(link.target || "/", req.url).toString();
  return NextResponse.redirect(target, 302);
}
