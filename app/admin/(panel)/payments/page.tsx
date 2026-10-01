import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { money, resolveRange, RANGE_PRESETS } from "@/lib/reports";
import { methodLabel, summarize, type PaymentRow } from "@/lib/payments";
import Link from "next/link";
import QuickPayment from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

type SP = { preset?: string; from?: string; to?: string; t?: string; kind?: string; method?: string };

/* Advance-payment ledger.
   COD shops live and die by "how much did the customer already pay?" — bKash advance before
   dispatch, rider collects the rest. Every row here is one real movement of money; the
   outstanding column is order total minus the rows, so it can never drift from the orders. */
export default async function PaymentsPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "orders");
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);
  const { start, end, label, preset } = resolveRange(searchParams);
  const kind = (searchParams.kind || "").toUpperCase();

  const rows = await db.payment.findMany({
    where: { createdAt: { gte: start, lte: end }, ...(kind ? { kind } : {}) },
    orderBy: { id: "desc" },
    take: 300,
  });
  const orderIds = Array.from(new Set(rows.map((r) => r.orderId)));
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, code: true, name: true, phone: true, total: true, status: true, paymentStatus: true, paymentMethod: true, createdAt: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // outstanding: everything not cancelled, minus what has actually been paid
  const openOrders = await db.order.findMany({
    where: { status: { notIn: ["CANCELLED", "RETURNED"] } },
    select: { id: true, code: true, name: true, phone: true, total: true, status: true, createdAt: true, payments: true },
    orderBy: { id: "desc" },
    take: 1500,
  });
  const withDue = openOrders
    .map((o) => ({ ...o, s: summarize(o.total, o.payments as PaymentRow[]) }))
    .filter((o) => o.s.balance > 0.5)
    .sort((a, b) => b.s.balance - a.s.balance);

  const collected = rows.filter((r) => r.kind !== "REFUND").reduce((a, r) => a + r.amount, 0);
  const advance = rows.filter((r) => r.kind === "ADVANCE").reduce((a, r) => a + r.amount, 0);
  const due = rows.filter((r) => r.kind === "DUE").reduce((a, r) => a + r.amount, 0);
  const refunded = rows.filter((r) => r.kind === "REFUND").reduce((a, r) => a + r.amount, 0);
  const outstanding = withDue.reduce((a, o) => a + o.s.balance, 0);
  const withAdvance = openOrders.filter((o) => summarize(o.total, o.payments as PaymentRow[]).advance > 0).length;
  const byMethod = new Map<string, number>();
  for (const r of rows) if (r.kind !== "REFUND") byMethod.set(r.method, (byMethod.get(r.method) || 0) + r.amount);

  const kpis = [
    { label: "Collected in range", val: money(collected), sub: `${rows.filter((r) => r.kind !== "REFUND").length} payments · ${label}` },
    { label: "Advance (before delivery)", val: money(advance), sub: `${withAdvance} open orders have an advance` },
    { label: "Collected at delivery", val: money(due), sub: "rider handed the cash in" },
    { label: "Refunded", val: money(refunded), sub: refunded > 0 ? "money went back out" : "no refunds in range" },
    { label: "Still to collect", val: money(outstanding), sub: `${withDue.length} open order${withDue.length === 1 ? "" : "s"} with a balance` },
    { label: "Net in hand", val: money(collected - refunded), sub: "collected − refunded" },
  ];

  return (
    <>
      <div className="admin-top">
        <div><h1>Payments</h1><div className="who">{label} · {user.name}</div></div>
        <form method="get" action="/admin/payments" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t && <input type="hidden" name="t" value={t} />}
          <select className="abtn" name="preset" defaultValue={preset}>
            {RANGE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="abtn" name="kind" defaultValue={kind}>
            <option value="">All kinds</option><option value="ADVANCE">Advance</option><option value="DUE">At delivery</option><option value="REFUND">Refund</option>
          </select>
          <button className="abtn primary" type="submit">Apply</button>
          <a className="abtn" href={tk("/api/admin/export?type=payments")}>CSV</a>
        </form>
      </div>

      <div className="kpis kpis-6" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {kpis.map((k) => <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div>{k.sub && <div className="k-sub">{k.sub}</div>}</div>)}
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 16, alignItems: "start", marginBottom: 16  }}>
        <div className="acard">
          <div className="acard-h"><h3>Record a payment</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>order code diye</span></div>
          <div className="acard-b"><QuickPayment /></div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Biggest balances still to collect</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>top {Math.min(10, withDue.length)}</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {withDue.length === 0 ? <div style={{ color: "var(--muted)" }}>Every open order is fully paid.</div> : (
              <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Advance</th><th>To collect</th></tr></thead>
                <tbody>
                  {withDue.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <td><Link href={tk("/admin/orders/" + o.id)}>{o.code}</Link><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.status}</div></td>
                      <td>{o.name}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.phone}</div></td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{money(o.total)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", color: o.s.advance ? "var(--ok)" : "var(--muted)" }}>{o.s.advance ? money(o.s.advance) : "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(o.s.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="acard">
        <div className="acard-h">
          <h3>Payment ledger</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {byMethod.size === 0 ? "no payments in range" : Array.from(byMethod.entries()).map(([m, v]) => `${methodLabel(m)} ${money(v)}`).join(" · ")}
          </span>
        </div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {rows.length === 0 ? <div style={{ color: "var(--muted)" }}>No payments recorded in this range yet. Open an order to add an advance, or use the quick form above.</div> : (
            <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>When</th><th>Order</th><th>Customer</th><th>Kind</th><th>Method</th><th>Amount</th><th>By</th><th>Note</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const o = orderById.get(r.orderId);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td><Link href={tk("/admin/orders/" + r.orderId)}>{o?.code || "#" + r.orderId}</Link></td>
                      <td>{o?.name || "—"}</td>
                      <td><span className={"pill " + (r.kind === "REFUND" ? "CANCELLED" : r.kind === "ADVANCE" ? "PROCESSING" : "DELIVERED")}>{r.kind}</span></td>
                      <td>{methodLabel(r.method)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.kind === "REFUND" ? "var(--ad-red, #b42318)" : undefined }}>{r.kind === "REFUND" ? "−" : ""}{money(r.amount)}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.createdBy || "—"}</td>
                      <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        A payment row is the record of money moving &mdash; bKash/Nagad advance before dispatch, cash the rider hands over,
        a refund back to the customer. The order&rsquo;s payment status follows these rows automatically (nothing paid → PENDING,
        fully covered → PAID), and removing a wrong row is audited.
      </div>
    </>
  );
}
