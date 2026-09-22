"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type P = { id: number; title: string; stock: number; lowStock: number; cost: number | null };

/* The missing half of the stock ledger: parcels coming IN.
   Until now stock could only be written by the system going down (a delivery, a cancellation
   putting it back) or by typing a new number straight into the product form — which left no
   record of where the stock came from. */
export default function RestockPanel({ products }: { products: P[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"add" | "set">("add");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const open = (p: P) => {
    setOpenId(openId === p.id ? null : p.id);
    setQty("");
    setCost(p.cost != null ? String(p.cost) : "");
    setNote("");
    setMode("add");
    setMsg(null);
  };

  const submit = async (p: P) => {
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/stock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: p.id, qty, unitCost: cost, note, mode }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    setMsg({ text: `${p.title}: ${j.delta > 0 ? "+" : ""}${j.delta} → ${j.stock} in stock${j.costUpdated ? " · cost updated" : ""}`, ok: true });
    setQty(""); setNote("");
    router.refresh();
  };

  if (!products.length) {
    return <div style={{ color: "var(--muted)" }}>Nothing needs restocking right now — every product is above its alert level.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {products.map((p) => (
        <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "11px 13px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <b style={{ fontSize: 14 }}>{p.title}</b>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {p.stock === 0 ? <span style={{ color: "var(--ad-red, #c62f2f)", fontWeight: 600 }}>out of stock</span> : <>{p.stock} left</>}
                {" · alerts under "}{p.lowStock}
                {p.cost == null && " · no cost set"}
              </div>
            </div>
            <button className={"abtn" + (openId === p.id ? "" : " primary")} onClick={() => open(p)}>
              {openId === p.id ? "Cancel" : p.stock === 0 ? "Restock" : "Add stock"}
            </button>
          </div>

          {openId === p.id && (
            <div className="form-grid" style={{ marginTop: 11, gap: 10 }}>
              <div className="af">
                <label>Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <option value="add">Add to current stock ({p.stock})</option>
                  <option value="set">Set exact count (stock take)</option>
                </select>
              </div>
              <div className="af">
                <label>{mode === "add" ? "How many arrived" : "Counted quantity"}</label>
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={mode === "add" ? "e.g. 24" : String(p.stock)} autoFocus />
              </div>
              <div className="af">
                <label>Unit cost (৳) — updates the product cost</label>
                <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="optional" />
              </div>
              <div className="af">
                <label>Note (supplier, invoice, reason)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Karim trader · inv 4821" />
              </div>
              <div className="full" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="abtn primary" disabled={busy} aria-busy={busy || undefined} onClick={() => submit(p)}>
                  {busy && <span className="spinner" aria-hidden="true" />} {busy ? "Saving…" : mode === "add" ? "Add to stock" : "Set count"}
                </button>
                {msg && <span style={{ fontSize: 12.5, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
