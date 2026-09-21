import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audienceCount } from "@/lib/campaign";
import Link from "next/link";
import CampaignClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletter" };

type SP = { t?: string };

/* Newsletter (feature: campaign send).
   The Subscriber list, its CSV export and the footer signup form have existed all along —
   there was simply no way to mail the list. This page composes, tests and sends. */
export default async function CampaignsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);

  const [rows, audience, all] = await Promise.all([
    db.campaign.findMany({ orderBy: { id: "desc" }, take: 100 }),
    audienceCount(),
    db.subscriber.count(),
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
          <h1>Newsletter</h1>
          <div className="who">{audience} reachable · {all - audience} unsubscribed · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="abtn" href={tk("/admin/marketing")}>Marketing</Link>
          <a className="abtn" href="/api/admin/export?type=subscribers" download>Subscribers CSV</a>
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Reachable</div><div className="k-val">{audience.toLocaleString("en-IN")}</div><div className="k-sub">will receive a campaign</div></div>
        <div className="kpi"><div className="k-label">Unsubscribed</div><div className="k-val">{Math.max(0, all - audience).toLocaleString("en-IN")}</div><div className="k-sub">never mailed again</div></div>
        <div className="kpi"><div className="k-label">Campaigns sent</div><div className="k-val">{rows.filter((c) => c.status === "SENT").length}</div><div className="k-sub">{rows.filter((c) => c.status === "SENDING").length ? `${rows.filter((c) => c.status === "SENDING").length} still sending` : "all finished"}</div></div>
        <div className="kpi"><div className="k-label">Emails delivered</div><div className="k-val">{totalSent.toLocaleString("en-IN")}</div><div className="k-sub">across every campaign</div></div>
      </div>

      <CampaignClient campaigns={campaigns} audience={audience} unsubscribed={Math.max(0, all - audience)} myEmail={user.email} />
    </>
  );
}
