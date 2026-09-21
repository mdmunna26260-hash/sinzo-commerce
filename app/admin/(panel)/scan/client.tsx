"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";

type Item = { id: number; title: string; variant: string; qty: number; price: number };
type Order = {
  id: number; code: string; name: string; phone: string; address: string; area: string; status: string;
  total: number; paymentMethod: string; paymentStatus: string; items: Item[];
  courierName: string | null; courierConsignmentId: string | null;
  packedAt: string | null; packedBy: string | null; notes: string | null; riskLevel: string;
};
type Queue = { id: number; code: string; name: string; area: string; total: number; status: string; createdAt: string };
type Recent = { id: number; code: string; name: string; packedAt: string | null; packedBy: string | null };

const money = (n: number) => "৳" + Number(n || 0).toLocaleString("en-IN");

export default function ScanClient() {
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Queue[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [counts, setCounts] = useState({ waiting: 0, packedToday: 0 });
  const box = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await afetch("/api/admin/scan");
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setQueue(j.queue || []); setRecent(j.recent || []); setCounts({ waiting: j.waiting || 0, packedToday: j.packedToday || 0 }); }
  };
  useEffect(() => { load(); box.current?.focus(); }, []);

  const lookup = async (value?: string) => {
    const v = (value ?? code).trim();
    if (!v) return;
    setBusy(true); setErr(""); setMsg(null); setOrder(null);
    const r = await afetch("/api/admin/scan?code=" + encodeURIComponent(v));
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error || "Lookup failed");
      // a scanner sends Enter after the code — clear it so the next scan is clean
      setCode("");
      return;
    }
    setOrder(j.order);
  };

  const pack = async () => {
    if (!order) return;
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: order.code }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: j.error || "Pack failed", ok: false }); return; }
    setOrder(j.order);
    setMsg({ text: j.already ? (j.message || "Already packed") : `${j.order.code} packed ✓ — slip print korte paren`, ok: true });
    setCode(""); box.current?.focus();
    load();
  };

  return (
    <>
      <div className="acard" style={{ marginBottom: 16 }}>
        <div className="acard-h">
          <h3>Scan a parcel</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{counts.waiting} waiting · {counts.packedToday} packed today</span>
        </div>
        <div className="acard-b">
          <form onSubmit={(e) => { e.preventDefault(); lookup(); }} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              ref={box}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan / type code — SZ-1042, consignment id, or 1042"
              autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text"
              style={{ flex: 1, minWidth: 240, padding: "14px 16px", fontSize: 17, letterSpacing: ".4px", border: "2px solid var(--accent)", borderRadius: 6, fontFamily: "ui-monospace, monospace" }}
            />
            <button className="abtn primary" type="submit" disabled={busy} style={{ padding: "0 20px" }}>{busy ? "…" : "Look up"}</button>
          </form>
          {err && <div className="noti err" style={{ marginTop: 12 }}>{err}</div>}
        </div>
      </div>

      {order && (
        <div className="acard" style={{ marginBottom: 16, borderColor: msg?.ok ? "var(--ok)" : undefined }}>
          <div className="acard-h">
            <h3>{order.code} · {order.name}</h3>
            <span className="pill SHIPPED">{order.status}</span>
          </div>
          <div className="acard-b">
            {(order.packedAt) && (
              <div className="noti" style={{ marginBottom: 12 }}>
                Already packed {new Date(order.packedAt).toLocaleString("en-GB")}{order.packedBy ? ` by ${order.packedBy}` : ""} — re-packing does nothing.
              </div>
            )}
            {["CANCELLED", "RETURNED"].includes(order.status) && (
              <div className="noti err" style={{ marginBottom: 12 }}>This order is {order.status}. Do not pack it.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ fontSize: 13.5 }}>
                <div><b>{order.name}</b> · {order.phone}</div>
                <div style={{ color: "var(--muted)", marginTop: 2 }}>{order.address}</div>
                <div style={{ marginTop: 4 }}>Area: <b>{order.area}</b> · Risk: {order.riskLevel}</div>
                <div style={{ marginTop: 4 }}>{order.paymentMethod} · {order.paymentStatus} · COD collect <b>{money(order.total)}</b></div>
                {order.notes && <div style={{ marginTop: 6, color: "var(--muted)" }}>Note: {order.notes}</div>}
                <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12.5 }}>
                  {order.courierName ? `Courier: ${order.courierName} ${order.courierConsignmentId || ""}` : "Not sent to a courier yet"}
                </div>
              </div>
              <div>
                <table className="tbl">
                  <thead><tr><th>Item</th><th>Qty</th></tr></thead>
                  <tbody>
                    {order.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.title}{it.variant ? ` — ${it.variant}` : ""}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{money(it.price)} each</div></td>
                        <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{it.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginTop: 12 }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button className="abtn primary" onClick={pack} disabled={busy || !!order.packedAt || ["CANCELLED", "RETURNED"].includes(order.status)}
                style={{ padding: "12px 22px", fontSize: 15, opacity: (busy || !!order.packedAt) ? .55 : 1 }}>
                {busy ? "…" : "✓ Confirm pack"}
              </button>
              <a className="abtn" href={`/admin/orders/${order.id}`}>Open order</a>
              <a className="abtn" href={`/admin/slip/${order.id}`} target="_blank" rel="noreferrer">🖨 Packing slip</a>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Waiting to pack</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>oldest first</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {queue.length === 0 ? <div style={{ color: "var(--muted)" }}>Nothing is waiting — every order is packed or shipped.</div> : (
              <table className="tbl">
                <thead><tr><th>Order</th><th>Customer</th><th>Area</th><th>COD</th><th>Age</th></tr></thead>
                <tbody>
                  {queue.map((o) => {
                    const hours = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 36e5);
                    return (
                      <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => lookup(o.code)}>
                        <td><b>{o.code}</b></td>
                        <td>{o.name}</td>
                        <td>{o.area}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{money(o.total)}</td>
                        <td style={{ color: hours > 24 ? "var(--ad-red, #b42318)" : "var(--muted)", whiteSpace: "nowrap" }}>{hours < 1 ? "just now" : hours + "h"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>Recently packed</h3></div>
          <div className="acard-b" style={{ fontSize: 13 }}>
            {recent.length === 0 ? <div style={{ color: "var(--muted)" }}>No parcel packed yet through this screen.</div> : recent.map((r) => (
              <div key={r.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                <b>{r.code}</b> · {r.name}
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {r.packedAt ? new Date(r.packedAt).toLocaleString("en-GB") : ""}{r.packedBy ? " · " + r.packedBy : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
