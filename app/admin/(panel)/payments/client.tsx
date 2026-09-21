"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

const METHODS = [["bkash", "bKash"], ["nagad", "Nagad"], ["rocket", "Rocket"], ["bank", "Bank"], ["cash", "Cash"], ["other", "Other"]];
const KINDS = [["ADVANCE", "Advance"], ["DUE", "Collected at delivery"], ["REFUND", "Refund"]];

/* Quick entry: paste/scan an order code, type the amount, done. Uses the same order-code
   resolver as the packing station, so "SZ-1042", "1042" and a consignment id all work. */
export default function QuickPayment() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bkash");
  const [kind, setKind] = useState("ADVANCE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const lr = await afetch("/api/admin/scan?code=" + encodeURIComponent(code.trim()));
    const lj = await lr.json().catch(() => ({}));
    if (!lr.ok) { setBusy(false); setMsg({ text: lj.error || "Order lookup failed", ok: false }); return; }
    const r = await afetch(`/api/admin/orders/${lj.order.id}/payments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, method, kind, note }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Could not save the payment", ok: false }); return; }
    setMsg({
      text: `${lj.order.code}: ${kind === "REFUND" ? "refunded" : "received"} ৳${Number(amount).toLocaleString("en-IN")} — paid ৳${j.summary.net.toLocaleString("en-IN")}, due ৳${j.summary.balance.toLocaleString("en-IN")} (${j.summary.state})`,
      ok: true,
    });
    setAmount(""); setNote(""); setCode("");
    router.refresh();
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <div className="af">
        <label>Order code</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SZ-1042 / 1042" required autoCapitalize="none" style={{ fontFamily: "ui-monospace, monospace" }} />
      </div>
      <div className="form-grid">
        <div className="af"><label>Amount (৳)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" step="0.01" required /></div>
        <div className="af"><label>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      <div className="af"><label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="af"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bKash TrxID, rider name…" /></div>
      <button className="abtn primary" type="submit" disabled={busy || !code.trim() || !amount} aria-busy={busy || undefined}>{busy ? "…" : "Save payment"}</button>
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
    </form>
  );
}
