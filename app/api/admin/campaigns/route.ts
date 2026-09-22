import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { audienceCount, sendTest } from "@/lib/campaign";

export const dynamic = "force-dynamic";

/* Newsletter campaigns (feature: admin → Newsletter).
   GET  — the list, newest first, plus how many addresses are currently reachable
   POST — create a draft, or send a test / start sending when `action` says so
   A send is started here and continued by POST /api/admin/campaigns/<id> in batches. */
export async function GET(req: Request) {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const [campaigns, audience] = await Promise.all([
    db.campaign.findMany({ orderBy: { id: "desc" }, take: 100 }),
    audienceCount(),
  ]);
  const all = await db.subscriber.count();
  return NextResponse.json({ campaigns, audience, unsubscribed: all - audience, total: all });
}

export async function POST(req: Request) {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    const action = String(b.action || "save");

    if (action === "test") {
      if (!b.subject || !b.body) return NextResponse.json({ error: "Subject and body required" }, { status: 400 });
      const to = String(b.to || g.user.email);
      const r = await sendTest({ subject: b.subject, body: b.body, ctaLabel: b.ctaLabel || null, ctaUrl: b.ctaUrl || null }, to);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      await logAudit(g.user.email, "CAMPAIGN_TEST", `test → ${to}`);
      return NextResponse.json({ ok: true, to });
    }

    if (!b.subject || !b.body) return NextResponse.json({ error: "Subject and body required" }, { status: 400 });
    const campaign = await db.campaign.create({
      data: {
        subject: String(b.subject).slice(0, 180),
        body: String(b.body),
        ctaLabel: b.ctaLabel ? String(b.ctaLabel).slice(0, 40) : null,
        ctaUrl: b.ctaUrl ? String(b.ctaUrl).slice(0, 300) : null,
        total: await audienceCount(),
        createdBy: g.user.email,
      },
    });
    await logAudit(g.user.email, "CAMPAIGN_SAVE", `${campaign.subject} (#${campaign.id})`);
    return NextResponse.json({ ok: true, campaign });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
