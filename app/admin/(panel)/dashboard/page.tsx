import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function money(n: number) { return "৳" + Math.round(n).toLocaleString("en-IN"); }

const IC = {
  banknote: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>,
  bag: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 7h12l1 13H5L6 7zm3 0a3 3 0 0 1 6 0" /></svg>,
  hash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  box: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>,
};

/* tiny line sparkline for KPI cards */
function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const W = 120, H = 30;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(H - 3 - (v / max) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="k-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--ad-green)" : "var(--ad-red)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

/* modern gradient area chart (pure SVG — no chart lib) */
function AreaChart({ days }: { days: { label: string; total: number }[] }) {
  const W = 600, H = 170, P = 10;
  const max = Math.max(...days.map((d) => d.total), 1);
  const x = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P - 16);
  const line = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(days.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  return (
    <>
      <svg className="achart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="adArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ad-accent)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--ad-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P - 16)} y2={H - P - f * (H - 2 * P - 16)} stroke="var(--ad-line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#adArea)" />
        <path d={line} fill="none" stroke="var(--ad-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.total)} r="3" fill="var(--ad-card)" stroke="var(--ad-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>{d.label}: {money(d.total)}</title>
          </circle>
        ))}
      </svg>
      <div className="achart-x">
        <span>{days[0]?.label}</span>
        <span>{days[Math.floor(days.length / 2)]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </>
  );
}

function Delta({ now, prev, sub }: { now: number; prev: number; sub?: string }) {
  if (prev === 0 && now === 0) return <div className="k-delta flat">— <span className="vs">{sub}</span></div>;
  if (prev === 0) return <div className="k-delta up">▲ +100% <span className="vs">{sub}</span></div>;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return <div className={"k-delta " + (up ? "up" : "down")}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% <span className="vs">{sub}</span></div>;
}

export default async function Dashboard({ searchParams }: { searchParams: any }) {
  const user = await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const t = (searchParams?.t as string) || "";
  const tk = (p: string) => (t ? p + "?t=" + encodeURIComponent(t) : p);

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1);
  const start7 = new Date(Date.now() - 7 * 86400000);
  const start14 = new Date(Date.now() - 14 * 86400000);
  const valid = { status: { notIn: ["CANCELLED"] } };

  const [todayAgg, weekAgg, allAgg, todayCount, allCount, customerCount, pendingCount, deliveredCount, cancelledCount, lowStock, recentOrders, topProducts,
    yesterdayAgg, prev7Agg, weekCount, prev7Count] = await Promise.all([
    db.order.aggregate({ where: { ...valid, createdAt: { gte: startToday } }, _sum: { total: true } }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: start7 } }, _sum: { total: true } }),
    db.order.aggregate({ where: valid, _sum: { total: true } }),
    db.order.count({ where: { createdAt: { gte: startToday } } }),
    db.order.count(),
    db.customer.count(),
    db.order.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: "DELIVERED" } }),
    db.order.count({ where: { status: { in: ["CANCELLED", "RETURNED"] } } }),
    db.product.findMany({ where: { status: "ACTIVE", stock: { lte: 5 } }, take: 6, select: { id: true, title: true, stock: true } }),
    db.order.findMany({ orderBy: { id: "desc" }, take: 8, include: { items: true } }),
    db.orderItem.groupBy({ by: ["productId", "title"], _count: { _all: true }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 5 }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: startYesterday, lt: startToday } }, _sum: { total: true } }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: start14, lt: start7 } }, _sum: { total: true } }),
    db.order.count({ where: { ...valid, createdAt: { gte: start7 } } }),
    db.order.count({ where: { ...valid, createdAt: { gte: start14, lt: start7 } } }),
  ]);

  const topIds = topProducts.map((x) => x.productId).filter(Boolean) as number[];
  const topImgs = topIds.length
    ? await db.product.findMany({ where: { id: { in: topIds } }, select: { id: true, images: { select: { url: true }, take: 1 } } })
    : [];
  const topImg = new Map(topImgs.map((p) => [p.id, p.images?.[0]?.url || ""]));

  // sales chart: last 14 days
  const days: { label: string; total: number }[] = [];
  const chartStart = new Date(Date.now() - 13 * 86400000); chartStart.setHours(0, 0, 0, 0);
  const ordersInRange = await db.order.findMany({ where: { createdAt: { gte: chartStart }, status: { notIn: ["CANCELLED"] } }, select: { createdAt: true, total: true } });
  for (let i = 0; i < 14; i++) {
    const d = new Date(chartStart.getTime() + i * 86400000);
    const next = new Date(d.getTime() + 86400000);
    const total = ordersInRange.filter((o) => o.createdAt >= d && o.createdAt < next).reduce((a, o) => a + o.total, 0);
    days.push({ label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), total });
  }
  const sum14 = days.reduce((a, d) => a + d.total, 0);

  const today = todayAgg._sum.total || 0;
  const yesterday = yesterdayAgg._sum.total || 0;
  const week = weekAgg._sum.total || 0;
  const prevWeek = prev7Agg._sum.total || 0;
  const total = allAgg._sum.total || 0;
  const aov = allCount ? total / allCount : 0;
  const aov7 = weekCount ? week / weekCount : 0;
  const aovPrev7 = prev7Count ? prevWeek / prev7Count : 0;

  return (
    <>
      <div className="admin-top">
        <div><h1>Dashboard</h1><div className="who">Welcome back, {user.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="abtn" href="/" target="_blank">View Website</Link>
          <Link className="abtn" href={tk("/admin/products")}>+ Add Product</Link>
          <Link className="abtn primary" href={tk("/admin/orders")}>View Orders</Link>
        </div>
      </div>

      {/* KPI row 1 — sales with trends */}
      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><div className="k-label">Today's Sales</div><div className="k-ic indigo">{IC.banknote}</div></div>
          <div className="k-val">{money(today)}</div>
          <div className="k-sub">{todayCount} order{todayCount !== 1 ? "s" : ""} today</div>
          <Delta now={today} prev={yesterday} sub="vs yesterday" />
          <Spark data={days.map((d) => d.total)} up={today >= yesterday} />
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">7-Day Sales</div><div className="k-ic violet">{IC.chart}</div></div>
          <div className="k-val">{money(week)}</div>
          <div className="k-sub">{weekCount} orders · last 7 days</div>
          <Delta now={week} prev={prevWeek} sub="vs prev 7 days" />
          <Spark data={days.map((d) => d.total)} up={week >= prevWeek} />
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">Total Sales</div><div className="k-ic blue">{IC.bag}</div></div>
          <div className="k-val">{money(total)}</div>
          <div className="k-sub">{allCount} orders all-time</div>
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">Avg Order Value</div><div className="k-ic cyan">{IC.hash}</div></div>
          <div className="k-val">{money(aov)}</div>
          <div className="k-sub">all-time</div>
          <Delta now={aov7} prev={aovPrev7} sub="7-day vs prev 7-day" />
        </div>
      </div>

      {/* KPI row 2 — operational counts */}
      <div className="stat-strip">
        <div className="kpi"><div className="k-top"><div className="k-label">Pending Orders</div><div className="k-ic amber">{IC.clock}</div></div><div className="k-val">{pendingCount}</div><div className="k-sub">needs confirmation</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Delivered</div><div className="k-ic green">{IC.check}</div></div><div className="k-val">{deliveredCount}</div><div className="k-sub">completed</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Cancelled / Returned</div><div className="k-ic red">{IC.x}</div></div><div className="k-val">{cancelledCount}</div><div className="k-sub">all-time</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Customers</div><div className="k-ic indigo">{IC.user}</div></div><div className="k-val">{customerCount}</div><div className="k-sub">total</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Low Stock</div><div className="k-ic amber">{IC.box}</div></div><div className="k-val">{lowStock.length}</div><div className="k-sub">{lowStock.length ? "needs restock" : "all good"}</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h">
            <h3>Sales — last 14 days</h3>
            <div style={{ fontSize: 12.5, color: "var(--ad-mute)", fontVariantNumeric: "tabular-nums" }}>Total {money(sum14)}</div>
          </div>
          <div className="acard-b">
            <AreaChart days={days} />
          </div>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>Top Products</h3></div>
          <div className="acard-b" style={{ padding: 0 }}>
            <table className="tbl">
              <thead><tr><th>Product</th><th style={{ textAlign: "right" }}>Units</th></tr></thead>
              <tbody>
                {topProducts.length === 0 && <tr><td colSpan={2} style={{ color: "var(--ad-mute)" }}>No sales yet</td></tr>}
                {topProducts.map((tp) => (
                  <tr key={tp.title}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {tp.productId && topImg.get(tp.productId) ? <img src={topImg.get(tp.productId)!} alt="" /> : <div style={{ width: 38, height: 48, borderRadius: 6, background: "var(--ad-line-soft)", flex: "none" }} />}
                        <span>{tp.title}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}><b>{tp._sum.qty}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="acard" style={{ marginTop: 16 }}>
        <div className="acard-h"><h3>Recent Orders</h3><Link className="abtn sm" href={tk("/admin/orders")}>All orders</Link></div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Risk</th><th></th></tr></thead>
            <tbody>
              {recentOrders.length === 0 && <tr><td colSpan={7} style={{ color: "var(--ad-mute)" }}>No orders yet — place a test order from the storefront!</td></tr>}
              {recentOrders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {o.items[0]?.image ? <img src={o.items[0].image} alt="" /> : <div style={{ width: 38, height: 48, borderRadius: 6, background: "var(--ad-line-soft)", flex: "none" }} />}
                      <div>
                        <b>{o.code}</b>
                        <div style={{ fontSize: 12, color: "var(--ad-mute)" }}>{new Date(o.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  </td>
                  <td>{o.name}<br /><span style={{ color: "var(--ad-mute)", fontSize: 12 }}>{o.phone}</span></td>
                  <td>{o.items.length}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}><b>{money(o.total)}</b></td>
                  <td><span className={"pill " + o.status}>{o.status}</span></td>
                  <td><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                  <td><Link className="abtn sm" href={tk("/admin/orders/" + o.id)}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
