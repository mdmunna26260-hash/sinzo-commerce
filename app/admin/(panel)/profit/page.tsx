import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { money, pct, units, resolveRange, RANGE_PRESETS, courierCost } from "@/lib/reports";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profit & Margin" };

type SP = { preset?: string; from?: string; to?: string; t?: string; sort?: string };

/* Profit & Margin.
   Item cost has been captured on every product (admin → Products → "Cost per item") since the
   beginning and never added up anywhere — this page is that sum. Two honest limits, both shown
   on the page rather than hidden:
     · COGS only counts lines whose product has a cost set. Coverage is displayed, and products
       without one are listed so the number can be sharpened.
     · Courier cost is what admin → Settings → Courier says Steadfast charges us, per area. If it
       isn't set, the page says "not set" instead of pretending delivery was free.
   Cancelled and returned orders are excluded from revenue (a returned parcel is not a sale) and
   reported separately, with the loss itself on Couriers & RTO. */
export default async function ProfitPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "orders");
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);
  const { start, end, label, preset } = resolveRange(searchParams);

  const s = await getSettings();
  const rangeQ = { createdAt: { gte: start, lte: end } };
  const [orders, products] = await Promise.all([
    db.order.findMany({
      where: rangeQ,
      orderBy: { id: "desc" },
      select: {
        id: true, code: true, status: true, total: true, deliveryFee: true, discount: true, area: true,
        courierConsignmentId: true, createdAt: true, name: true, phone: true,
        items: { select: { productId: true, title: true, qty: true, price: true } },
      },
    }),
    db.product.findMany({ select: { id: true, title: true, slug: true, cost: true, price: true, stock: true, status: true } }),
  ]);

  const costOf = new Map<number, number | null>();
  const titleOf = new Map<number, string>();
  const slugOf = new Map<number, string>();
  for (const p of products) { costOf.set(p.id, p.cost); titleOf.set(p.id, p.title); slugOf.set(p.id, p.slug); }

  const revenueOrders = orders.filter((o) => o.status !== "CANCELLED" && o.status !== "RETURNED");
  const deadOrders = orders.filter((o) => o.status === "CANCELLED" || o.status === "RETURNED");

  let itemRevenue = 0, cogs = 0, disc = 0, deliveryCollected = 0, courierSpend = 0, courierUnknown = 0, notShipped = 0;
  let unitsSold = 0, unitsWithCost = 0;
  const perProduct = new Map<number, { id: number; title: string; slug: string; qty: number; revenue: number; cogs: number; uncosted: number }>();
  const perOrder: { code: string; id: number; at: Date; name: string; net: number; cogs: number; profit: number; courier: number | null; margin: number }[] = [];

  for (const o of revenueOrders) {
    const gross = o.items.reduce((a, i) => a + i.price * i.qty, 0);
    const net = gross - o.discount;             // what we keep for the goods
    let oCogs = 0;
    for (const i of o.items) {
      const c = i.productId != null ? costOf.get(i.productId) : null;
      unitsSold += i.qty;
      if (c != null) { oCogs += c * i.qty; unitsWithCost += i.qty; } else courierUnknown += 0;
      if (i.productId != null) {
        const row = perProduct.get(i.productId) || { id: i.productId, title: titleOf.get(i.productId) || i.title, slug: slugOf.get(i.productId) || "", qty: 0, revenue: 0, cogs: 0, uncosted: 0 };
        row.qty += i.qty; row.revenue += i.price * i.qty;
        if (c != null) row.cogs += c * i.qty; else row.uncosted += i.qty;
        perProduct.set(i.productId, row);
      }
    }
    /* A courier bill is only incurred once the parcel is actually handed over. Charging every
       order the moment it is placed would inflate this figure with parcels still sitting on the
       shelf, so only shipped/delivered/returned orders are priced here. */
    const shipped = !!o.courierConsignmentId || o.status === "DELIVERED" || o.status === "RETURNED";
    const cc = shipped ? courierCost(s, o.area) : null;
    if (!shipped) notShipped++;
    else if (cc == null) courierUnknown++;
    else courierSpend += cc;
    itemRevenue += net; cogs += oCogs; disc += o.discount; deliveryCollected += o.deliveryFee;
    const profit = net - oCogs;
    perOrder.push({ code: o.code, id: o.id, at: o.createdAt, name: o.name, net, cogs: oCogs, profit, courier: cc, margin: net ? profit / net : 0 });
  }

  const grossProfit = itemRevenue - cogs;
  const margin = itemRevenue ? grossProfit / itemRevenue : 0;
  const netAfterCourier = grossProfit - courierSpend;
  const coverage = unitsSold ? unitsWithCost / unitsSold : 1;
  const orderAvg = revenueOrders.length ? grossProfit / revenueOrders.length : 0;
  const unitAvg = unitsSold ? grossProfit / unitsSold : 0;

  const worst = [...perOrder].sort((a, b) => a.profit - b.profit).slice(0, 8);
  const rows = [...perProduct.values()].map((r) => ({
    ...r, profit: r.revenue - r.cogs, margin: r.revenue ? (r.revenue - r.cogs) / r.revenue : 0,
  }));
  const sortKey = searchParams.sort || "profit";
  rows.sort((a, b) => (sortKey === "units" ? b.qty - a.qty : sortKey === "margin" ? a.margin - b.margin : sortKey === "revenue" ? b.revenue - a.revenue : b.profit - a.profit));

  const noCost = products.filter((p) => p.cost == null && p.status === "ACTIVE");
  const stockValue = products.reduce((a, p) => a + (p.cost ?? 0) * p.stock, 0);

  const kpis = [
    { label: "Item revenue", val: money(itemRevenue), sub: `${revenueOrders.length} orders · after discounts` },
    { label: "Cost of goods", val: money(cogs), sub: `${units(unitsWithCost)} of ${units(unitsSold)} units had a cost` },
    { label: "Gross profit", val: money(grossProfit), sub: "revenue − cost of goods" },
    { label: "Margin", val: pct(margin), sub: `${money(unitAvg)} per unit · ${money(orderAvg)} per order` },
    { label: "Courier spend", val: courierSpend ? "−" + money(courierSpend) : "not set", sub: courierUnknown ? `${courierUnknown} shipped orders have no rate` : notShipped ? `${notShipped} orders not shipped yet` : "every shipped parcel priced" },
    { label: "Net after courier", val: money(netAfterCourier), sub: "before ads & packaging" },
  ];

  return (
    <>
      <div className="admin-top">
        <div><h1>Profit &amp; Margin</h1><div className="who">{label} · {user.name}</div></div>
        <form method="get" action="/admin/profit" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t && <input type="hidden" name="t" value={t} />}
          <select className="abtn" name="preset" defaultValue={preset}>
            {RANGE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="abtn" type="date" name="from" defaultValue={searchParams.from || ""} style={{ colorScheme: "light" }} />
          <input className="abtn" type="date" name="to" defaultValue={searchParams.to || ""} />
          <button className="abtn primary" type="submit">Apply</button>
        </form>
      </div>

      <div className="kpis kpis-6" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {kpis.map((k) => <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div>{k.sub && <div className="k-sub">{k.sub}</div>}</div>)}
      </div>

      {coverage < 1 && (
        <div className="cfg-note" style={{ marginBottom: 16 }}>
          ⚠ Cost price missing on <b>{pct(1 - coverage)}</b> of the units sold in this range, so gross profit is
          overstated by whatever those items actually cost you. {noCost.length > 0 && <>Add it on any product
          ("Cost per item") — <Link href={tk("/admin/products")}>start with these {noCost.length}</Link>.</>}
        </div>
      )}
      {courierSpend === 0 && (
        <div className="cfg-note" style={{ marginBottom: 16 }}>
          ℹ Courier charge per parcel is not set, so delivery cost is left out of the numbers above (collected
          delivery fees are {money(deliveryCollected)}{notShipped > 0 ? `, and ${notShipped} orders have not been handed to a courier yet` : ""}). Set it once in{" "}
          <Link href={tk("/admin/settings")}>Settings → Courier → Inside/Outside Dhaka charge</Link> and this page
          will subtract it per order.
        </div>
      )}

      <div className="acard" style={{ marginBottom: 16 }}>
        <div className="acard-h">
          <h3>Per product</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {revenueOrders.length} orders ·{" "}
            {[["profit", "by profit"], ["margin", "worst margin first"], ["units", "by units"], ["revenue", "by revenue"]].map(([k, l], i) => (
              <span key={k}>{i > 0 && " · "}<Link href={tk(`/admin/profit?preset=${preset}&sort=${k}`)} style={{ color: sortKey === k ? "var(--accent)" : "inherit", textDecoration: sortKey === k ? "underline" : "none" }}>{l}</Link></span>
            ))}
            {" · "}<Link href={tk("/api/admin/export?type=products")} style={{ textDecoration: "underline" }}>CSV</Link>
          </span>
        </div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {rows.length === 0 ? <div style={{ color: "var(--muted)" }}>No orders in this range.</div> : (
            <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Stock</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 300 }}>{r.title}{r.uncosted > 0 && <span style={{ color: "var(--ad-amber, #b54708)", fontSize: 11.5 }}> · {r.uncosted} unit{r.uncosted > 1 ? "s" : ""} without cost</span>}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{units(r.qty)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{money(r.revenue)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.cogs ? money(r.cogs) : "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: r.profit < 0 ? "var(--ad-red, #b42318)" : undefined, fontWeight: 600 }}>{money(r.profit)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: r.margin < 0 ? "var(--ad-red, #b42318)" : undefined }}>{r.cogs ? pct(r.margin) : "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{r.slug ? <Link href={tk("/admin/products?edit=" + r.id)}>{units(products.find((p) => p.id === r.id)?.stock ?? 0)}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start"  }}>
        <div className="acard">
          <div className="acard-h"><h3>Thinnest orders</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>worst 8 by profit</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {worst.length === 0 ? <div style={{ color: "var(--muted)" }}>—</div> : (
              <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Order</th><th>Date</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Courier</th></tr></thead>
                <tbody>
                  {worst.map((o) => (
                    <tr key={o.code}>
                      <td><Link href={tk("/admin/orders/" + o.id)}>{o.code}</Link><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.name}</div></td>
                      <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{o.at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{money(o.net)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{o.cogs ? money(o.cogs) : "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: o.profit < 0 ? "var(--ad-red, #b42318)" : undefined }}>{money(o.profit)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{o.courier == null ? "not set" : money(o.courier)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Context</h3></div>
          <div className="acard-b" style={{ display: "grid", gap: 9, fontSize: 13.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Delivery fees collected</span><b>{money(deliveryCollected)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Discounts given</span><b>−{money(disc)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Stock on hand (at cost)</span><b>{money(stockValue)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Avg margin per order</span><b>{money(orderAvg)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 9, borderTop: "1px solid var(--line)" }}>
              <span>Excluded from revenue</span>
              <b>{deadOrders.length} cancelled / returned</b>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              A returned parcel is not a sale, so it is left out here — what it cost you is on{" "}
              <Link href={tk("/admin/couriers")} style={{ textDecoration: "underline" }}>Couriers &amp; RTO</Link>. These
              figures are before ads, packaging and any fixed cost.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
