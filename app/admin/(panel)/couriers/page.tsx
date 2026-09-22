import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { money, pct, units, resolveRange, RANGE_PRESETS, courierCost, parcelState, monthKey, monthLabel } from "@/lib/reports";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Couriers & RTO" };

type SP = { preset?: string; from?: string; to?: string; t?: string };

/* Courier performance & RTO.
   In a COD business the returned parcel is the most expensive thing that happens: the goods
   come back, the courier still bills both legs, and nothing was sold. Until now that cost was
   invisible — order status showed RETURNED on one row at a time and no screen ever added it up.
   Classification of Steadfast's free-text statuses lives in lib/reports.parcelState() so this
   page, Profit and the order list never disagree about what "delivered" means. */
export default async function CouriersPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);
  const { start, end, label, preset } = resolveRange(searchParams);

  const s = await getSettings();
  const orders = await db.order.findMany({
    where: { createdAt: { gte: start, lte: end } },
    orderBy: { id: "desc" },
    select: {
      id: true, code: true, name: true, phone: true, area: true, status: true, total: true,
      paymentMethod: true, riskLevel: true, courierName: true, courierStatus: true,
      courierConsignmentId: true, createdAt: true,
    },
  });

  const state = new Map<number, ReturnType<typeof parcelState>>();
  for (const o of orders) state.set(o.id, parcelState(o));

  const sent = orders.filter((o) => o.courierConsignmentId);
  const delivered = orders.filter((o) => state.get(o.id) === "delivered");
  const rto = orders.filter((o) => state.get(o.id) === "rto");
  const moving = orders.filter((o) => state.get(o.id) === "moving");
  const resolved = delivered.length + rto.length;

  const cod = (list: typeof orders) => list.reduce((a, o) => a + (o.paymentMethod === "COD" ? o.total : 0), 0);
  const collected = cod(delivered);
  const blocked = cod(rto);

  /* What the returns cost: courier charges for parcels that came back. Uses the inside/outside
     rate from Settings → Courier; parcels with no rate set are counted separately. */
  let rtoLoss = 0, rtoUnpriced = 0;
  for (const o of rto) {
    const c = courierCost(s, o.area);
    if (c == null) rtoUnpriced++;
    else rtoLoss += c;
  }

  const successRate = resolved ? delivered.length / resolved : 0;
  const rtoRate = resolved ? rto.length / resolved : 0;

  const group = (key: (o: (typeof orders)[number]) => string) => {
    const m = new Map<string, { key: string; sent: number; delivered: number; rto: number; moving: number; value: number; blocked: number; loss: number }>();
    for (const o of sent) {
      const k = key(o) || "—";
      const row = m.get(k) || { key: k, sent: 0, delivered: 0, rto: 0, moving: 0, value: 0, blocked: 0, loss: 0 };
      row.sent++;
      const st = state.get(o.id);
      if (st === "delivered") { row.delivered++; row.value += o.total; }
      else if (st === "rto") { row.rto++; row.blocked += o.total; row.loss += courierCost(s, o.area) ?? 0; }
      else row.moving++;
      m.set(k, row);
    }
    return [...m.values()].map((r) => ({ ...r, rate: r.delivered + r.rto ? r.rto / (r.delivered + r.rto) : 0 })).sort((a, b) => b.sent - a.sent);
  };

  const byCourier = group((o) => o.courierName || "Unknown courier");
  const byArea = group((o) => (/INSIDE/i.test(o.area) ? "Inside Dhaka" : "Outside Dhaka"));
  const byRisk = group((o) => o.riskLevel || "LOW");
  const byPay = group((o) => (o.paymentMethod === "COD" ? "Cash on delivery" : o.paymentMethod || "Other"));

  /* Repeat RTO customers — same phone, more than one returned parcel. Deliberately read-only:
     the decision to blacklist is the owner's, this only shows who keeps costing money. */
  const byPhone = new Map<string, { phone: string; name: string; orders: number; rto: number; blocked: number; lastAt: Date; id: number }>();
  for (const o of orders) {
    const row = byPhone.get(o.phone) || { phone: o.phone, name: o.name, orders: 0, rto: 0, blocked: 0, lastAt: o.createdAt, id: o.id };
    row.orders++;
    if (state.get(o.id) === "rto") { row.rto++; row.blocked += o.total; }
    if (o.createdAt > row.lastAt) { row.lastAt = o.createdAt; row.name = o.name; row.id = o.id; }
    byPhone.set(o.phone, row);
  }
  const repeat = [...byPhone.values()].filter((r) => r.rto > 0).sort((a, b) => b.rto - a.rto || b.blocked - a.blocked).slice(0, 12);

  /* Monthly RTO trend — the number that should be going down. */
  const trend = new Map<string, { sent: number; delivered: number; rto: number }>();
  for (const o of sent) {
    const k = monthKey(o.createdAt);
    const row = trend.get(k) || { sent: 0, delivered: 0, rto: 0 };
    row.sent++;
    const st = state.get(o.id);
    if (st === "delivered") row.delivered++;
    else if (st === "rto") row.rto++;
    trend.set(k, row);
  }
  const months = [...trend.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8);

  const kpis = [
    { label: "Parcels sent", val: units(sent.length), sub: `${orders.length} orders booked in range` },
    { label: "Delivered", val: pct(successRate), sub: `${units(delivered.length)} of ${units(resolved)} closed` },
    { label: "Returned (RTO)", val: units(rto.length), sub: resolved ? `${pct(rtoRate)} of closed parcels` : "nothing closed yet" },
    { label: "Still moving", val: units(moving.length), sub: "not delivered, not returned" },
    { label: "COD collected", val: money(collected), sub: "delivered orders" },
    { label: "Stuck at courier", val: money(blocked), sub: `${units(rto.length)} returned parcels` },
  ];

  return (
    <>
      <div className="admin-top">
        <div><h1>Couriers &amp; RTO</h1><div className="who">{label} · {user.name}</div></div>
        <form method="get" action="/admin/couriers" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t && <input type="hidden" name="t" value={t} />}
          <select className="abtn" name="preset" defaultValue={preset}>
            {RANGE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="abtn" type="date" name="from" defaultValue={searchParams.from || ""} />
          <input className="abtn" type="date" name="to" defaultValue={searchParams.to || ""} />
          <button className="abtn primary" type="submit">Apply</button>
        </form>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {kpis.map((k) => <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div>{k.sub && <div className="k-sub">{k.sub}</div>}</div>)}
      </div>

      <div className="cfg-note" style={{ marginBottom: 16 }}>
        {rto.length === 0
          ? "No parcel came back in this range — that is what a healthy number looks like."
          : <>Returned parcels cost <b>{money(rtoLoss)}</b> in courier charges alone{rtoUnpriced > 0 && <> (plus {rtoUnpriced} parcels with no rate set)</>}, on top of <b>{money(blocked)}</b> of goods that came back instead of being sold. Both legs of a returned parcel are paid; that is why an RTO rate above 10% eats a margin alive.</>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginBottom: 16 }}>
        <div className="acard">
          <div className="acard-h"><h3>By courier</h3></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {byCourier.length === 0 ? <div style={{ color: "var(--muted)" }}>No parcels booked in this range.</div> : (
              <table className="tbl">
                <thead><tr><th>Courier</th><th>Sent</th><th>Delivered</th><th>RTO</th><th>RTO %</th><th>Loss</th></tr></thead>
                <tbody>
                  {byCourier.map((r) => (
                    <tr key={r.key}>
                      <td style={{ textTransform: "capitalize" }}>{r.key}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.sent}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.delivered}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.rto}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.rate > 0.1 ? "var(--ad-red, #b42318)" : "var(--ad-green, #067647)" }}>{r.delivered + r.rto ? pct(r.rate) : "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.loss ? money(r.loss) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Where parcels go</h3></div>
          <div className="acard-b" style={{ display: "grid", gap: 14 }}>
            <table className="tbl">
              <thead><tr><th>Zone</th><th>Sent</th><th>Delivered</th><th>RTO</th><th>RTO %</th></tr></thead>
              <tbody>
                {byArea.length === 0 ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>—</td></tr> : byArea.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.sent}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.delivered}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.rto}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.rate > 0.1 ? "var(--ad-red, #b42318)" : "var(--ad-green, #067647)" }}>{r.delivered + r.rto ? pct(r.rate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                RTO by the risk level the fraud check gave the order at checkout — if HIGH is not clearly worse than LOW, the flags need tuning.
              </div>
              <table className="tbl">
                <thead><tr><th>Risk</th><th>Sent</th><th>RTO</th><th>RTO %</th></tr></thead>
                <tbody>
                  {byRisk.map((r) => (
                    <tr key={r.key}>
                      <td>{r.key}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.sent}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.rto}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.delivered + r.rto ? pct(r.rate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>COD vs prepaid — the honest argument for asking for an advance on risky orders.</div>
              <table className="tbl">
                <thead><tr><th>Payment</th><th>Sent</th><th>RTO</th><th>RTO %</th></tr></thead>
                <tbody>
                  {byPay.map((r) => (
                    <tr key={r.key}>
                      <td>{r.key}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.sent}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.rto}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.delivered + r.rto ? pct(r.rate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Repeated returns</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>customers whose parcels came back</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {repeat.length === 0 ? <div style={{ color: "var(--muted)" }}>Nobody in this range has a returned parcel. 👌</div> : (
              <table className="tbl">
                <thead><tr><th>Customer</th><th>Orders</th><th>RTO</th><th>Goods returned</th><th>Last</th></tr></thead>
                <tbody>
                  {repeat.map((r) => (
                    <tr key={r.phone}>
                      <td>
                        <Link href={tk("/admin/orders/" + r.id)}>{r.name}</Link>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.phone}</div>
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.orders}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.rto > 1 ? "var(--ad-red, #b42318)" : undefined }}>{r.rto}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{money(r.blocked)}</td>
                      <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{r.lastAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="acard-b" style={{ paddingTop: 0, fontSize: 12, color: "var(--muted)" }}>
            Before booking a courier for one of these numbers again, ask for an advance — that is the only thing
            that reliably stops a repeat return, and it is cheaper than the two-way courier bill.
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>RTO month by month</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>last 8 months</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {months.length === 0 ? <div style={{ color: "var(--muted)" }}>No parcels booked yet.</div> : (
              <table className="tbl">
                <thead><tr><th>Month</th><th>Sent</th><th>Delivered</th><th>RTO</th><th>RTO %</th><th style={{ width: "26%" }}></th></tr></thead>
                <tbody>
                  {months.map(([k, r]) => {
                    const rate = r.delivered + r.rto ? r.rto / (r.delivered + r.rto) : 0;
                    return (
                      <tr key={k}>
                        <td>{monthLabel(k)}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.sent}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.delivered}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.rto}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{pct(rate)}</td>
                        <td>
                          <span style={{ display: "block", height: 8, borderRadius: 99, background: "var(--ad-line, #e4e7ec)", overflow: "hidden" }}>
                            <span style={{ display: "block", height: "100%", width: Math.min(100, Math.round(rate * 400)) + "%", background: rate > 0.1 ? "var(--ad-red, #b42318)" : "var(--ad-green, #067647)" }} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="acard-b" style={{ paddingTop: 0, fontSize: 12, color: "var(--muted)" }}>
            Bar is scaled to 25% = full width, so a 10% month is visibly worse than a 3% month.
          </div>
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        &ldquo;Parcels sent&rdquo; counts orders that actually got a consignment id, so orders still waiting to be handed
        to the courier are not counted as delivery failures. Loss uses the Inside/Outside Dhaka courier rate from{" "}
        <Link href={tk("/admin/settings")}>Settings → Courier</Link>. Goods value of returned parcels is also missing
        from revenue on <Link href={tk("/admin/profit")}>Profit &amp; Margin</Link>.
      </div>
    </>
  );
}
