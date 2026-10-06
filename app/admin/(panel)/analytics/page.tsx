import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Advanced Analytics" };

const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const pct = (n: number) => (n * 100).toFixed(1) + "%";

type SP = { preset?: string; from?: string; to?: string; t?: string; sort?: string };

function resolveRange(sp: SP): { start: Date; end: Date; label: string } {
  const now = new Date();
  const nowT = now.getTime();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start = new Date(nowT - 29 * 86400000); start.setHours(0, 0, 0, 0);
  let label = "Last 30 days";
  if (sp.preset === "today") { start = new Date(nowT); start.setHours(0, 0, 0, 0); label = "Today"; }
  else if (sp.preset === "yesterday") { start = new Date(nowT - 86400000); start.setHours(0, 0, 0, 0); end.setTime(start.getTime()); end.setHours(23, 59, 59, 999); label = "Yesterday"; }
  else if (sp.preset === "7") { start = new Date(nowT - 6 * 86400000); start.setHours(0, 0, 0, 0); label = "Last 7 days"; }
  else if (sp.preset === "90") { start = new Date(nowT - 89 * 86400000); start.setHours(0, 0, 0, 0); label = "Last 90 days"; }
  else if (sp.preset === "custom" && sp.from && sp.to) {
    start = new Date(sp.from + "T00:00:00"); const e = new Date(sp.to + "T23:59:59");
    if (!isNaN(start.getTime()) && !isNaN(e.getTime())) { end.setTime(e.getTime()); label = `${sp.from} → ${sp.to}`; }
  }
  return { start, end, label };
}

export default async function AnalyticsPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "orders");
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);
  const { start, end, label } = resolveRange(searchParams);

  const rangeQ = { createdAt: { gte: start, lte: end } };
  const [ordersAll, priorPhones, events, products, orderItems] = await Promise.all([
    db.order.findMany({ where: rangeQ, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { createdAt: { lt: start } }, select: { phone: true }, distinct: ["phone"] }),
    db.trackingEvent.findMany({ where: { ...rangeQ, name: { in: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout"] } }, select: { name: true, payload: true } }),
    db.product.findMany({ select: { id: true, title: true, slug: true, views: true, stock: true, images: true } }),
    db.orderItem.findMany({ where: { order: { ...rangeQ, status: { notIn: ["CANCELLED"] } } }, select: { productId: true, title: true, qty: true, price: true, image: true } }),
  ]);

  const valid = ordersAll.filter((o) => o.status !== "CANCELLED");
  const revenue = valid.reduce((a, o) => a + o.total, 0);
  const aov = valid.length ? revenue / valid.length : 0;

  // ---- funnel from real events ----
  const sessions = new Set<string>();
  let viewContent = 0, addToCart = 0, checkout = 0;
  const atcByProduct = new Map<number, number>();
  for (const e of events) {
    let data: any = {};
    try { data = JSON.parse(e.payload || "{}"); } catch {}
    if (e.name === "PageView" && data.sid) sessions.add(data.sid);
    if (e.name === "ViewContent") viewContent++;
    if (e.name === "AddToCart") {
      addToCart++;
      const ids = data?.content_ids || data?.contents?.map?.((c: any) => c.id) || [];
      for (const id of ids) { const k = Number(id); if (k) atcByProduct.set(k, (atcByProduct.get(k) || 0) + 1); }
    }
    if (e.name === "InitiateCheckout") checkout++;
  }
  const convRate = sessions.size ? valid.length / sessions.size : null;

  // ---- daily revenue/orders buckets ----
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const bucketCount = Math.min(days, 30);
  const buckets: { label: string; start: Date; end: Date; revenue: number; orders: number }[] = [];
  const step = Math.max(86400000, Math.ceil((end.getTime() - start.getTime()) / bucketCount));
  for (let i = 0; i < bucketCount; i++) {
    const bStart = new Date(start.getTime() + i * step);
    const bEnd = new Date(Math.min(bStart.getTime() + step, end.getTime() + 1));
    if (bStart >= end) break;
    buckets.push({ label: bStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), start: bStart, end: bEnd, revenue: 0, orders: 0 });
  }
  for (const o of valid) {
    const b = buckets.find((b) => o.createdAt >= b.start && o.createdAt < b.end);
    if (b) { b.revenue += o.total; b.orders++; }
  }
  const maxRev = Math.max(...buckets.map((b) => b.revenue), 1);

  // ---- status distribution ----
  const statusMap = new Map<string, number>();
  for (const o of ordersAll) statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
  const statusRows = [...statusMap.entries()].sort((a, b) => b[1] - a[1]);

  // ---- sources & campaigns ----
  const srcMap = new Map<string, { orders: number; revenue: number }>();
  const campMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of valid) {
    const src = o.source || "Direct";
    const s = srcMap.get(src) || { orders: 0, revenue: 0 };
    s.orders++; s.revenue += o.total; srcMap.set(src, s);
    try {
      const attr = o.attribution ? JSON.parse(o.attribution) : {};
      const camp = attr.utm_campaign;
      if (camp) { const c = campMap.get(camp) || { orders: 0, revenue: 0 }; c.orders++; c.revenue += o.total; campMap.set(camp, c); }
    } catch {}
  }
  const srcRows = [...srcMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);
  const campRows = [...campMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);

  // ---- product performance ----
  const prodAgg = new Map<number, { units: number; revenue: number }>();
  for (const it of orderItems) {
    if (!it.productId) continue;
    const a = prodAgg.get(it.productId) || { units: 0, revenue: 0 };
    a.units += it.qty; a.revenue += it.qty * it.price;
    prodAgg.set(it.productId, a);
  }
  const sortKey = searchParams.sort || "revenue";
  const productRows = products.map((p) => {
    const a = prodAgg.get(p.id) || { units: 0, revenue: 0 };
    return { ...p, units: a.units, revenue: a.revenue, conv: p.views ? a.units / p.views : 0, atc: atcByProduct.get(p.id) || 0 };
  }).sort((x, y) => (sortKey === "units" ? y.units - x.units : sortKey === "views" ? y.views - x.views : sortKey === "conv" ? y.conv - x.conv : y.revenue - x.revenue)).slice(0, 10);

  // ---- customers ----
  const priorSet = new Set(priorPhones.map((p) => p.phone));
  const byPhone = new Map<string, { name: string; orders: number; spent: number }>();
  for (const o of valid) {
    const c = byPhone.get(o.phone) || { name: o.name, orders: 0, spent: 0 };
    c.orders++; c.spent += o.total; byPhone.set(o.phone, c);
  }
  const newCustomers = [...byPhone.keys()].filter((p) => !priorSet.has(p)).length;
  const returningCustomers = byPhone.size - newCustomers;
  const repeatRate = byPhone.size ? [...byPhone.values()].filter((c) => c.orders > 1).length / byPhone.size : 0;
  const avgFreq = byPhone.size ? valid.length / byPhone.size : 0;
  const topCustomers = [...byPhone.entries()].map(([phone, c]) => ({ phone, ...c })).sort((a, b) => b.spent - a.spent).slice(0, 5);

  const funnel = [
    { label: "Sessions", v: sessions.size, hint: "unique visitors" },
    { label: "Product views", v: viewContent, hint: "ViewContent events" },
    { label: "Add to cart", v: addToCart, hint: "" },
    { label: "Checkout started", v: checkout, hint: "" },
    { label: "Orders", v: valid.length, hint: "" },
  ];
  const funnelMax = Math.max(...funnel.map((f) => f.v), 1);

  const kpis = [
    { label: "Revenue", val: money(revenue) },
    { label: "Orders", val: String(valid.length) },
    { label: "Avg Order Value", val: money(aov) },
    { label: "Conversion Rate", val: convRate == null ? "—" : pct(convRate), sub: sessions.size ? "" : "PageView data ase nai ekhono" },
    { label: "Units Sold", val: String(orderItems.reduce((a, i) => a + i.qty, 0)) },
    { label: "New Customers", val: String(newCustomers) },
  ];

  const presets: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["custom", "Custom"]];
  const activePreset = searchParams.preset || "30";

  return (
    <>
      <div className="admin-top">
        <div><h1>Advanced Analytics</h1><div className="who">{label} · {user.name}</div></div>
        <form method="get" action="/admin/analytics" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t && <input type="hidden" name="t" value={t} />}
          <select className="abtn" name="preset" defaultValue={activePreset}>
            {presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="abtn" type="date" name="from" defaultValue={searchParams.from || ""} style={{ colorScheme: "light" }} />
          <input className="abtn" type="date" name="to" defaultValue={searchParams.to || ""} />
          <button className="abtn primary" type="submit">Apply</button>
        </form>
      </div>

      <div className="kpis kpis-6">
        {kpis.map((k) => <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div>{k.sub && <div className="k-sub">{k.sub}</div>}</div>)}
      </div>

      {/* FUNNEL */}
      <div className="acard" style={{ marginBottom: 16 }}>
        <div className="acard-h"><h3>Conversion Funnel</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>session → order</span></div>
        <div className="acard-b" style={{ display: "grid", gap: 10 }}>
          {funnel.map((f, i) => (
            <div key={f.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span><b>{f.v}</b> · {f.label} {f.hint && <span style={{ color: "var(--muted)" }}>({f.hint})</span>}</span>
                <span style={{ color: "var(--muted)" }}>{i === 0 ? "" : `${funnel[i - 1].v ? pct(f.v / funnel[i - 1].v) : "—"} of previous · ${f.v ? pct(f.v / funnelMax) : "0%"} overall`}</span>
              </div>
              <div className="ad-track" style={{ height: 22, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: Math.max(2, (f.v / funnelMax) * 100) + "%", height: "100%", background: "linear-gradient(90deg, var(--accent), #c9ab84)", borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="adm-split adm-split-wide">
        {/* REVENUE CHART */}
        <div className="acard">
          <div className="acard-h"><h3>Revenue &amp; Orders over time</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{valid.length} orders · {money(revenue)}</span></div>
          <div className="acard-b bar-chart-wrap">
            <div className="bar-chart">
              {buckets.map((b, i) => (
                <div key={i} className="bar" style={{ height: Math.max(3, (b.revenue / maxRev) * 160) + "px" }} title={`${b.label}: ${money(b.revenue)} (${b.orders} orders)`}>
                  <span>{i % Math.ceil(buckets.length / 8) === 0 ? b.label.split(" ")[0] : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* STATUS */}
        <div className="acard">
          <div className="acard-h"><h3>Order Status Breakdown</h3></div>
          <div className="acard-b" style={{ display: "grid", gap: 8 }}>
            {statusRows.length === 0 && <span style={{ color: "var(--muted)", fontSize: 13 }}>No orders in range.</span>}
            {statusRows.map(([st, n]) => (
              <div key={st} style={{ fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span className={"pill " + st}>{st}</span><span><b>{n}</b> · {pct(n / ordersAll.length)}</span>
                </div>
                <div className="ad-track" style={{ height: 8, borderRadius: 99 }}>
                  <div style={{ width: (n / ordersAll.length) * 100 + "%", height: "100%", borderRadius: 99, background: "var(--text)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="adm-split adm-split-even">
        {/* SOURCES */}
        <div className="acard">
          <div className="acard-h"><h3>Traffic → Order Sources</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Source</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              {srcRows.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", padding: 20 }}>No orders in range.</td></tr>}
              {srcRows.map(([src, v]) => <tr key={src}><td><b>{src}</b></td><td>{v.orders}</td><td>{money(v.revenue)}</td></tr>)}
            </tbody>
          </table>
          </div>
        </div>
        {/* CAMPAIGNS */}
        <div className="acard">
          <div className="acard-h"><h3>Campaign Attribution (utm_campaign)</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Campaign</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              {campRows.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", padding: 20 }}>Kono campaign-tagged order nai. Facebook ads chalale ?utm_campaign=... link diye attribution ekhane dekhabe.</td></tr>}
              {campRows.map(([c, v]) => <tr key={c}><td><b>{c}</b></td><td>{v.orders}</td><td>{money(v.revenue)}</td></tr>)}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* PRODUCTS */}
      <div className="acard" style={{ marginBottom: 16 }}>
        <div className="acard-h">
          <h3>Product Performance (Top 10)</h3>
          <span style={{ display: "flex", gap: 6, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}>
            Sort:
            {[["revenue", "Revenue"], ["units", "Units"], ["views", "Views"], ["conv", "Conv%"]].map(([v, l]) => (
              <Link key={v} className={"abtn sm" + (sortKey === v ? " primary" : "")} href={tk(`/admin/analytics?preset=${activePreset}${searchParams.from ? "&from=" + searchParams.from : ""}${searchParams.to ? "&to=" + searchParams.to : ""}&sort=${v}`)}>{l}</Link>
            ))}
          </span>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Product</th><th>Views (total)</th><th>Add-to-carts (period)</th><th>Units sold</th><th>Revenue</th><th>Conv.</th><th>Stock</th></tr></thead>
            <tbody>
              {productRows.map((p) => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 260 }}>{p.images?.[0] && <img src={p.images[0].url} alt="" style={{ display: "inline", width: 32, height: 40, objectFit: "cover", borderRadius: 3, marginRight: 8, verticalAlign: "middle" }} />}{p.title}</td>
                  <td>{p.views}</td>
                  <td>{p.atc}</td>
                  <td><b>{p.units}</b></td>
                  <td><b>{money(p.revenue)}</b></td>
                  <td>{p.views ? pct(p.conv) : "—"}</td>
                  <td>{p.stock <= 5 ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>{p.stock}</span> : p.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CUSTOMERS */}
      <div className="adm-split adm-split-narrow" style={{ marginBottom: 0 }}>
        <div className="acard">
          <div className="acard-h"><h3>Customer Retention</h3></div>
          <div className="acard-b" style={{ display: "grid", gap: 12, fontSize: 13.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>New customers</span><b>{newCustomers}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Returning customers</span><b>{returningCustomers}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Repeat purchase rate</span><b>{byPhone.size ? pct(repeatRate) : "—"}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Order frequency</span><b>{avgFreq.toFixed(2)} orders/customer</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Avg customer value</span><b>{money(byPhone.size ? revenue / byPhone.size : 0)}</b></div>
            <div style={{ height: 10 }}>
              <div style={{ display: "flex", height: 14, borderRadius: 99, overflow: "hidden", marginTop: 6 }}>
                <div style={{ width: (newCustomers / Math.max(1, byPhone.size)) * 100 + "%", background: "var(--accent)" }} title="New" />
                <div style={{ flex: 1, background: "#33538c" }} title="Returning" />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>🟧 New vs 🔵 Returning</div>
            </div>
          </div>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>Top Customers (by revenue)</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>LTV (range)</th></tr></thead>
            <tbody>
              {topCustomers.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", padding: 20 }}>No customers in range.</td></tr>}
              {topCustomers.map((c) => (
                <tr key={c.phone}><td><b>{c.name}</b></td><td>{c.phone}</td><td>{c.orders}</td><td><b>{money(c.spent)}</b></td></tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
      <div style={{ height: 30 }} />
    </>
  );
}
