import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audienceCount } from "@/lib/campaign";
import Link from "next/link";
import CampaignClient from "./client";
import PushBroadcastPanel from "@/components/admin/push-broadcast";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletter" };

type SP = { t?: string };

/* Newsletter page. Houses:
   - Subscriber count + CSV export
   - Email campaign composer (CampaignClient)
   - Subscribers list (recent 200)
   - Web Push broadcast (moved here from Marketing — both are outbound
     messaging channels and belong in one place) */
export default async function CampaignsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);

  const [rows, audience, all, subscribers, pushTotal, pushWithPhone] = await Promise.all([
    db.campaign.findMany({ orderBy: { id: "desc" }, take: 100 }),
    audienceCount(),
    db.subscriber.count(),
    db.subscriber.findMany({ orderBy: { id: "desc" }, take: 200 }),
    db.pushSubscription.count().catch(() => 0),
    db.pushSubscription.count({ where: { phone: { not: null } } }).catch(() => 0),
  ]);
  const campaigns = rows.map((c) => ({
    id: c.id, subject: c.subject, body: c.body, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl,
    status: c.status, total: c.total, sent: c.sent, failed: c.failed,
    createdAt: c.createdAt.toISOString(), sentAt: c.sentAt ? c.sentAt.toISOString() : null,
  }));
  const totalSent = rows.reduce((a, c) => a + c.sent, 0);

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>Newsletter &amp; Push</h1>
          <div className="who">{audience} reachable emails · {all - audience} unsubscribed · {pushTotal} push device{pushTotal === 1 ? "" : "s"} · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="abtn" href={tk("/admin/marketing")}>Marketing</Link>
          <a className="abtn" href="/api/admin/export?type=subscribers" download>Subscribers CSV</a>
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Email — Reachable</div><div className="k-val">{audience.toLocaleString("en-IN")}</div><div className="k-sub">will receive a campaign</div></div>
        <div className="kpi"><div className="k-label">Email — Unsubscribed</div><div className="k-val">{Math.max(0, all - audience).toLocaleString("en-IN")}</div><div className="k-sub">never mailed again</div></div>
        <div className="kpi"><div className="k-label">Push devices</div><div className="k-val">{pushTotal}</div><div className="k-sub">{pushWithPhone} linked to a phone</div></div>
        <div className="kpi"><div className="k-label">Emails delivered</div><div className="k-val">{totalSent.toLocaleString("en-IN")}</div><div className="k-sub">across every campaign</div></div>
      </div>

      <CampaignClient campaigns={campaigns} audience={audience} unsubscribed={Math.max(0, all - audience)} myEmail={user.email} />

      <div className="acard" style={{ marginTop: 16 }}>
        <div className="acard-h">
          <h3>Recent subscribers</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>latest {subscribers.length} · footer form + checkout + Google login</span>
        </div>
        <div className="acard-b" style={{ maxHeight: 320, overflow: "auto", fontSize: 13 }}>
          {subscribers.length === 0 && <span style={{ color: "var(--muted)" }}>No subscribers yet.</span>}
          {subscribers.map((s: any) => (
            <div key={s.id} style={{ padding: "6px 0", borderBottom: "1px solid #f0f2f5", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{s.email}</span>
              {s.unsubscribed ? <span style={{ color: "var(--danger)", fontSize: 11.5 }}>unsubscribed</span> : <span style={{ color: "var(--ok)", fontSize: 11.5 }}>active</span>}
            </div>
          ))}
        </div>
      </div>

      <PushBroadcastPanel push={{ total: pushTotal, withPhone: pushWithPhone }} />
    </>
  );
}
