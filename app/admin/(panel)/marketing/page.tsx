import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");
export default async function MarketingPage({ searchParams }: { searchParams: any }) {
  await requireAdmin(searchParams);
  const [abandoned, subscribers, sources] = await Promise.all([
    db.abandonedCheckout.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    db.subscriber.findMany({ orderBy: { id: "desc" }, take: 200 }),
    db.order.groupBy({ by: ["source"], _count: { _all: true }, _sum: { total: true } }),
  ]);
  const open = abandoned.filter((a) => !a.recovered);
  const recovered = abandoned.filter((a) => a.recovered);
  const rate = abandoned.length ? Math.round((recovered.length / abandoned.length) * 100) : 0;
  return (
    <>
      <div className="admin-top"><h1>Marketing &amp; Recovery</h1></div>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi"><div className="k-label">Abandoned Checkouts</div><div className="k-val">{open.length}</div><div className="k-sub">not recovered</div></div>
        <div className="kpi"><div className="k-label">Recovered</div><div className="k-val">{recovered.length}</div></div>
        <div className="kpi"><div className="k-label">Recovery Rate</div><div className="k-val">{rate}%</div></div>
        <div className="kpi"><div className="k-label">Newsletter Subscribers</div><div className="k-val">{subscribers.length}</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Abandoned Checkouts (latest 50)</h3></div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Items</th><th>Value</th><th>Status</th></tr></thead>
            <tbody>
              {abandoned.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", padding: 30 }}>No abandoned checkouts recorded yet.</td></tr>}
              {abandoned.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontSize: 12.5 }}>{new Date(a.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ fontSize: 12.5 }}>{JSON.parse(a.cartJson || "[]").map((i: any) => i.title + " ×" + i.qty).join(", ").slice(0, 80)}</td>
                  <td><b>{money(a.total)}</b></td>
                  <td><span className={"pill " + (a.recovered ? "DELIVERED" : "PENDING")}>{a.recovered ? "RECOVERED" : "OPEN"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Order Sources</h3></div>
            <table className="tbl">
              <thead><tr><th>Source</th><th>Orders</th><th>Revenue</th></tr></thead>
              <tbody>
                {sources.sort((a, b) => (b._sum.total || 0) - (a._sum.total || 0)).map((s) => (
                  <tr key={s.source || "Direct"}><td>{s.source || "Direct"}</td><td>{s._count._all}</td><td><b>{money(s._sum.total || 0)}</b></td></tr>
                ))}
                {sources.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", padding: 20 }}>No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="acard">
            <div className="acard-h"><h3>Subscribers</h3><a className="abtn sm" href={`/api/admin/export?type=subscribers${searchParams?.t ? "&t=" + encodeURIComponent(searchParams.t) : ""}`}>⭳ CSV</a></div>
            <div className="acard-b" style={{ maxHeight: 300, overflow: "auto", fontSize: 13 }}>
              {subscribers.length === 0 && <span style={{ color: "var(--muted)" }}>No subscribers yet.</span>}
              {subscribers.map((s) => <div key={s.id} style={{ padding: "5px 0", borderBottom: "1px solid #f1efec" }}>{s.email}</div>)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
