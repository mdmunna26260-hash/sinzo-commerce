import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { money, units, resolveRange, RANGE_PRESETS } from "@/lib/reports";
import Link from "next/link";
import RestockPanel from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock" };

type SP = { preset?: string; from?: string; to?: string; t?: string; reason?: string; product?: string };

/* Stock ledger.
   InventoryMovement has been written since the beginning — by deliveries, cancellations, returns
   and order edits — but nothing ever displayed it, and nothing could add stock. So this page has
   two jobs: show the history the system already keeps, and take in the half it never had
   (a restock, a stock take). */
const REASON_LABEL: Record<string, string> = {
  ORDER: "Sold (delivered)", DELIVERED: "Sold (delivered)", RESTOCK: "Restocked",
  MANUAL: "Manual change", ADJUST: "Stock take", CANCEL: "Order cancelled", RETURN: "Returned",
};

export default async function StockPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);
  const { start, end, label, preset } = resolveRange(searchParams);
  const reason = (searchParams.reason || "").toUpperCase();
  const productFilter = Number(searchParams.product || 0);

  const [products, movements, inRange] = await Promise.all([
    db.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, title: true, slug: true, stock: true, lowStock: true, cost: true, status: true, barcode: true, sku: true },
      orderBy: { stock: "asc" },
    }),
    db.inventoryMovement.findMany({
      where: { ...(reason ? { reason } : {}), ...(productFilter ? { productId: productFilter } : {}) },
      orderBy: { id: "desc" },
      take: 120,
      include: { product: { select: { title: true, slug: true } } },
    }),
    db.inventoryMovement.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { delta: true, reason: true, productId: true },
    }),
  ]);

  const stockValue = products.reduce((a, p) => a + (p.cost ?? 0) * p.stock, 0);
  const totalUnits = products.reduce((a, p) => a + p.stock, 0);
  const out = products.filter((p) => p.stock <= 0);
  const low = products.filter((p) => p.stock > 0 && p.stock <= (p.lowStock || 5));
  const needCost = products.filter((p) => p.cost == null && p.status === "ACTIVE").length;

  const soldUnits = inRange.filter((r) => r.reason === "ORDER" || r.reason === "DELIVERED").reduce((a, r) => a + Math.abs(r.delta), 0);
  const restockedUnits = inRange.filter((r) => r.reason === "RESTOCK").reduce((a, r) => a + r.delta, 0);
  const backUnits = inRange.filter((r) => r.reason === "CANCEL" || r.reason === "RETURN").reduce((a, r) => a + r.delta, 0);
  const adjustment = inRange.filter((r) => r.reason === "MANUAL" || r.reason === "ADJUST").reduce((a, r) => a + r.delta, 0);

  const kpis = [
    { label: "Units in stock", val: units(totalUnits), sub: `${products.length} active products` },
    { label: "Stock value at cost", val: money(stockValue), sub: needCost ? `${needCost} products have no cost` : "every product priced" },
    { label: "Out of stock", val: units(out.length), sub: out.length ? "customers see SOLD OUT" : "nothing is sold out" },
    { label: "Low stock", val: units(low.length), sub: "at or under the alert level" },
    { label: "Sold in range", val: units(soldUnits), sub: label },
    { label: "Restocked in range", val: units(restockedUnits), sub: backUnits ? `+${units(backUnits)} back from cancels/returns` : "no returns came back" },
  ];

  const reasons = ["", "RESTOCK", "DELIVERED", "CANCEL", "RETURN", "MANUAL", "ADJUST"];

  return (
    <>
      <div className="admin-top">
        <div><h1>Stock</h1><div className="who">{label} · {user.name}</div></div>
        <form method="get" action="/admin/stock" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t && <input type="hidden" name="t" value={t} />}
          <select className="abtn" name="preset" defaultValue={preset}>
            {RANGE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="abtn" name="product" type="number" placeholder="product id" defaultValue={searchParams.product || ""} style={{ width: 120 }} />
          <button className="abtn primary" type="submit">Apply</button>
        </form>
      </div>

      <div className="kpis kpis-6" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {kpis.map((k) => <div className="kpi" key={k.label}><div className="k-label">{k.label}</div><div className="k-val">{k.val}</div>{k.sub && <div className="k-sub">{k.sub}</div>}</div>)}
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginBottom: 16  }}>
        <div className="acard">
          <div className="acard-h"><h3>Restock</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{out.length + low.length} products need attention</span></div>
          <div className="acard-b">
            <RestockPanel products={[...out, ...low].map((p) => ({ id: p.id, title: p.title, stock: p.stock, lowStock: p.lowStock, cost: p.cost }))} />
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Stock value by product</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>cost × units on hand</span></div>
          <div className="acard-b" style={{ overflowX: "auto", maxHeight: 420 }}>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 240 }}>
                      <Link href={tk("/admin/products?edit=" + p.id)}>{p.title}</Link>
                      {p.sku && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.sku}{p.barcode ? " · " + p.barcode : ""}</div>}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: p.stock <= 0 ? "var(--ad-red, #b42318)" : p.stock <= (p.lowStock || 5) ? "var(--ad-amber, #b54708)" : undefined, fontWeight: p.stock <= (p.lowStock || 5) ? 600 : 400 }}>{units(p.stock)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{p.cost == null ? "—" : money(p.cost)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.cost == null ? "—" : money(p.cost * p.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="acard">
        <div className="acard-h">
          <h3>Stock ledger</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {reasons.map((r, i) => (
              <span key={r || "all"}>
                {i > 0 && " · "}
                <Link href={tk(`/admin/stock?preset=${preset}&reason=${r}${productFilter ? "&product=" + productFilter : ""}`)}
                  style={{ color: reason === r ? "var(--accent)" : "inherit", textDecoration: reason === r ? "underline" : "none" }}>
                  {r === "" ? "all" : (REASON_LABEL[r] || r)}
                </Link>
              </span>
            ))}
          </span>
        </div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {movements.length === 0 ? <div style={{ color: "var(--muted)" }}>No movements for this filter yet.</div> : (
            <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>When</th><th>Product</th><th>Change</th><th>Why</th><th>Reference</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{m.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ maxWidth: 260 }}><Link href={tk("/admin/products?edit=" + m.productId)}>{m.product?.title || "#" + m.productId}</Link></td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: m.delta < 0 ? "var(--ad-red, #b42318)" : "var(--ok)" }}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                    <td>{REASON_LABEL[m.reason] || m.reason}</td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{m.ref || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Every stock change is recorded here: a courier delivery takes stock down, a cancellation or return puts it
        back, editing an order or the product form logs an adjustment, and a restock adds it. That is what makes
        &ldquo;why is this 3?&rdquo; answerable. {adjustment !== 0 && <>Net manual adjustment in this range: <b>{adjustment > 0 ? "+" : ""}{adjustment}</b>.</>}
      </div>
    </>
  );
}
