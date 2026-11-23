"use client";
import { afetch } from "@/lib/afetch";
import { adjustedStock, parseStockAdjustment } from "@/lib/stock-adjustment";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Variant = { id: number; size: string | null; color: string | null; sku: string | null; barcode?: string | null; stock: number };
type P = { id: number; title: string; stock: number; lowStock: number; cost: number | null; sku?: string | null; barcode?: string | null; variants?: Variant[] };
type Row = { key: string; product: P; variant?: Variant; label: string; stock: number };

export default function RestockPanel({ products, attentionOnly = false }: { products: P[]; attentionOnly?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(products);
  useEffect(() => { setItems(products); }, [products]);
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState(attentionOnly);
  const [openId, setOpenId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"add" | "set">("add");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const dirty = !!openId && (!!qty || !!cost || !!note);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      if (!confirm("Leave with an unsaved stock adjustment or operation in progress?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [dirty, busy]);
  const rows = useMemo(() => items.flatMap(product => [
    { key: "p" + product.id, product, stock: product.stock, label: "Product total" },
    ...(product.variants || []).map(variant => ({ key: "v" + variant.id, product, variant, stock: variant.stock, label: [variant.size, variant.color].filter(Boolean).join(" / ") || "Variant #" + variant.id })),
  ] as Row[]), [items]);
  const selected = rows.find(row => row.key === openId);
  const matches = rows.filter(row => (!attention || row.stock <= row.product.lowStock) && (!query || [row.product.title, row.product.sku, row.product.barcode, row.label, row.variant?.sku, row.variant?.barcode].join(" ").toLowerCase().includes(query.trim().toLowerCase())));
  const shown = matches.slice(0, 40);
  if (selected && !shown.some(row => row.key === selected.key)) shown.unshift(selected);
  const open = (row: Row) => {
    if (mutation.current || (dirty && !confirm("Discard this unsaved stock adjustment?"))) return;
    setOpenId(openId === row.key ? null : row.key);
    setQty(""); setCost(""); setNote(""); setMode("add"); setMsg(null);
  };
  const preview = (row: Row) => {
    try {
      const input = parseStockAdjustment({ productId: row.product.id, qty, unitCost: cost, note, mode });
      const next = adjustedStock(row.stock, mode, input.qty);
      const productNext = row.variant ? adjustedStock(row.product.stock, "add", next - row.stock) : next;
      return { input, next, productNext, error: "" };
    } catch (error: any) { return { input: null, next: row.stock, productNext: row.product.stock, error: error.message }; }
  };
  const submit = async (row: Row) => {
    if (mutation.current) return;
    const plan = preview(row);
    if (!plan.input) { setMsg({ text: plan.error, ok: false }); return; }
    if (!confirm(row.product.title + " - " + row.label + ": " + row.stock + " -> " + plan.next + (row.variant ? ". Product total: " + row.product.stock + " -> " + plan.productNext : "") + (cost !== "" ? ". Product unit cost -> BDT " + cost : "") + ". Save this adjustment?")) return;
    mutation.current = true; setBusy(true); setMsg(null);
    try {
      const r = await afetch("/api/admin/stock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plan.input, ...(row.variant ? { variantId: row.variant.id } : {}), expectedStock: row.stock, expectedProductStock: row.product.stock }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setMsg({ text: j.error || "Could not save. Your inputs are kept.", ok: false });
        if (r.status === 409) router.refresh();
        return;
      }
      setItems(current => current.map(product => product.id !== row.product.id ? product : {
        ...product, stock: j.productStock ?? j.stock, cost: j.costUpdated ? Number(cost) : product.cost,
        variants: product.variants?.map(variant => variant.id === row.variant?.id ? { ...variant, stock: j.stock } : variant),
      }));
      setMsg({ text: row.label + ": " + row.stock + " -> " + j.stock + " saved." + (j.costUpdated ? " Product cost updated." : ""), ok: true });
      setQty(""); setCost(""); setNote(""); router.refresh();
    } catch { setMsg({ text: "Could not confirm the save. Inputs are kept. Refresh counts before retrying to avoid applying an adjustment twice.", ok: false }); }
    finally { mutation.current = false; setBusy(false); }
  };
  return <section className="stock-quick" aria-label="Quick inventory update">
    <p className="stock-quick-hint">Search by product, size, color, SKU or barcode. Variant adjustments change the product total by the same amount. Product-only adjustments leave variant counts unchanged.</p>
    <label className="stock-search-label" htmlFor="inventory-search">Find stock</label>
    <input id="inventory-search" type="search" className="asearch" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} placeholder="Product, size, SKU or barcode" />
    <label className="stock-attention-toggle"><input type="checkbox" checked={attention} disabled={busy} onChange={e => setAttention(e.target.checked)} />At or below alert level only</label>
    {msg && <p className={"stock-feedback " + (msg.ok ? "is-ok" : "is-error")} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    <p className="stock-quick-hint">{matches.length} matching rows. Showing up to 40 plus the open adjustment. Narrow your search for more.</p>
    {!shown.length && <p className="stock-quick-hint">No matching products or variants. Try another search or clear the alert filter.</p>}
    {shown.map(row => {
      const plan = row.key === openId ? preview(row) : null;
      return <article className="stock-quick-row" key={row.key}>
        <div className="stock-quick-heading"><div><strong>{row.product.title}</strong><small>{row.label}{row.variant?.sku || row.product.sku ? " | " + (row.variant?.sku || row.product.sku) : ""}</small><span>{row.stock} in stock | alert level {row.product.lowStock}</span></div><button type="button" className="abtn" disabled={busy} aria-expanded={row.key === openId} aria-label={(row.key === openId ? "Close " : "Adjust ") + row.product.title + " " + row.label} onClick={() => open(row)}>{row.key === openId ? "Close" : "Adjust"}</button></div>
        {row.key === openId && <fieldset className="stock-adjust-fields form-grid" disabled={busy}>
          <div className="af"><label htmlFor="stock-mode">Action</label><select id="stock-mode" value={mode} onChange={e => setMode(e.target.value as "add" | "set")}><option value="add">Add / subtract units</option><option value="set">Set exact counted stock</option></select></div>
          <div className="af"><label htmlFor="stock-quantity">{mode === "add" ? "Units to add (negative removes)" : "Exact counted quantity"}</label><input id="stock-quantity" type="number" step="1" min={mode === "set" ? 0 : undefined} inputMode={mode === "set" ? "numeric" : "text"} value={qty} onChange={e => setQty(e.target.value)} placeholder={mode === "add" ? "e.g. 12 or -2" : "e.g. 0"} /></div>
          <div className="af"><label htmlFor="stock-cost">Product unit cost (BDT, optional)</label><input id="stock-cost" type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="Blank keeps current cost" /></div>
          <div className="af"><label htmlFor="stock-note">Reason / supplier / invoice</label><input id="stock-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional reference" /></div>
          <div className="stock-preview full" aria-live="polite">{plan?.input ? <><strong>{row.label}: {row.stock} -&gt; {plan.next}</strong>{row.variant && <span>Product total: {row.product.stock} -&gt; {plan.productNext}</span>}{cost !== "" && <span>Product unit cost: BDT {row.product.cost ?? "not set"} -&gt; {cost}</span>}</> : qty && <span>{plan?.error}</span>}</div>
          <div className="stock-adjust-actions full"><button type="button" className="abtn" onClick={() => { if (!mutation.current) { router.refresh(); setMsg({ text: "Counts refresh requested. Inputs are kept; review the preview before saving.", ok: true }); } }}>Refresh counts</button><button type="button" className="abtn primary" disabled={busy || !plan?.input} aria-busy={busy || undefined} onClick={() => submit(row)}>{busy ? "Saving..." : "Review and save"}</button></div>
        </fieldset>}
      </article>;
    })}
  </section>;
}
