import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function money(n: number) { return "৳" + Math.round(n).toLocaleString("en-IN"); }

export default async function Dashboard({ searchParams }: { searchParams: any }) {
  const user = await requireAdmin(searchParams);
  const t = (searchParams?.t as string) || "";
  const tk = (p: string) => (t ? p + "?t=" + encodeURIComponent(t) : p);

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const start7 = new Date(Date.now() - 7 * 86400000);
  const start30 = new Date(Date.now() - 30 * 86400000);
  const valid = { status: { notIn: ["CANCELLED"] } };

  const [todayAgg, weekAgg, allAgg, todayCount, allCount, customerCount, pendingCount, deliveredCount, cancelledCount, lowStock, recentOrders, statusGroups, topProducts] = await Promise.all([
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
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.orderItem.groupBy({ by: ["productId", "title"], _count: { _all: true }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 5 }),
  ]);

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
  const max = Math.max(...days.map((d) => d.total), 1);
  const aov = allCount ? (allAgg._sum.total || 0) / allCount : 0;

  const kpis = [
    { label: "Today's Sales", val: money(todayAgg._sum.total || 0), sub: `${todayCount} order${todayCount !== 1 ? "s" : ""}` },
    { label: "7-Day Sales", val: money(weekAgg._sum.total || 0), sub: "last 7 days" },
    { label: "Total Sales", val: money(allAgg._sum.total || 0), sub: `${allCount} orders all-time` },
    { label: "Avg Order Value", val: money(aov), sub: "all-time" },
  ];

  return (
    <>
      <div className="admin-top">
        <div><h1>Dashboard</h1><div className="who">Welcome back, {user.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="abtn" href={tk("/admin/products")}>+ Add Product</Link>
          <Link className="abtn primary" href={tk("/admin/orders")}>View Orders</Link>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div><div className="k-sub">{k.sub}</div></div>
        ))}
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="kpi"><div className="k-label">Pending Orders</div><div className="k-val">{pendingCount}</div><div className="k-sub">needs confirmation</div></div>
        <div className="kpi"><div className="k-label">Delivered</div><div className="k-val">{deliveredCount}</div></div>
        <div className="kpi"><div className="k-label">Cancelled / Returned</div><div className="k-val">{cancelledCount}</div></div>
        <div className="kpi"><div className="k-label">Customers</div><div className="k-val">{customerCount}</div></div>
        <div className="kpi"><div className="k-label">Low Stock Items</div><div className="k-val">{lowStock.length > 0 ? lowStock.length : "0"}</div><div className="k-sub">{lowStock.length ? "needs restock" : "all good"}</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Sales — last 14 days</h3></div>
          <div className="acard-b bar-chart-wrap">
            <div className="bar-chart">
              {days.map((d, i) => (
                <div key={i} className="bar" style={{ height: Math.max(3, (d.total / max) * 160) + "px" }} title={`${d.label}: ${money(d.total)}`}>
                  <span>{i % 2 === 0 ? d.label.split(" ")[0] : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>Top Products</h3></div>
          <div className="acard-b" style={{ padding: 0 }}>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Units</th></tr></thead>
              <tbody>
                {topProducts.length === 0 && <tr><td colSpan={2} style={{ color: "var(--muted)" }}>No sales yet</td></tr>}
                {topProducts.map((t) => (
                  <tr key={t.title}><td>{t.title}</td><td><b>{t._sum.qty}</b></td></tr>
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
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Risk</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {recentOrders.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No orders yet — place a test order from the storefront!</td></tr>}
              {recentOrders.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.code}</b></td>
                  <td>{o.name}<br /><span style={{ color: "var(--muted)", fontSize: 12 }}>{o.phone}</span></td>
                  <td>{o.items.length}</td>
                  <td><b>{money(o.total)}</b></td>
                  <td><span className={"pill " + o.status}>{o.status}</span></td>
                  <td><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                  <td style={{ fontSize: 12.5 }}>{new Date(o.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
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
