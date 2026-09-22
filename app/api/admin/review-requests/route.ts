import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { getSettings, envFallback, saveGroup } from "@/lib/settings";
import { sendReviewRequest, reviewRequestQueue, reviewRequestStats, autoReviewRequestEnabled } from "@/lib/review-request";
export const dynamic = "force-dynamic";

/* Review requests: the queue of delivered orders nobody has asked yet, plus the auto switch. */
export async function GET(req: Request) {
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const [queue, stats] = await Promise.all([reviewRequestQueue(100), reviewRequestStats()]);
  const logs = await db.appLog.findMany({ where: { message: { contains: "review request" } }, orderBy: { id: "desc" }, take: 15 });
  return NextResponse.json({ ok: true, queue, stats, autoRequest: autoReviewRequestEnabled(s), logs });
}

export async function POST(req: Request) {
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));
  const s = envFallback(await getSettings());
  const action = String(b.action || "send");

  if (action === "toggle") {
    const current = await getSettings(true);
    await saveGroup("reviews", { ...((current as any).reviews || {}), autoRequest: !!b.autoRequest });
    await logAudit(g.user.email, "REVIEW_AUTO", b.autoRequest ? "on" : "off");
    return NextResponse.json({ ok: true, autoRequest: !!b.autoRequest });
  }

  if (action === "send") {
    const r = await sendReviewRequest(Number(b.orderId), s, { force: !!b.force });
    await logAudit(g.user.email, "REVIEW_REQUEST", `order #${b.orderId} → ${r.channel || "failed"}${r.skipped ? " (" + r.skipped + ")" : ""}`);
    return NextResponse.json({ ...r }, { status: r.ok || r.skipped ? 200 : 502 });
  }

  if (action === "send_batch") {
    const limit = Math.min(15, Math.max(1, Number(b.limit) || 5));
    const queue = await reviewRequestQueue(limit);
    const results: any[] = [];
    for (const o of queue) {
      // sequential on purpose: the WhatsApp bridge dislikes bursts, and this is a background chore
      const r = await sendReviewRequest(o.id, s).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      results.push({ code: o.code, ...r });
    }
    const sent = results.filter((r) => r.ok).length;
    await logAudit(g.user.email, "REVIEW_REQUEST_BATCH", `${sent}/${results.length} sent`);
    return NextResponse.json({ ok: true, sent, failed: results.length - sent, results });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
