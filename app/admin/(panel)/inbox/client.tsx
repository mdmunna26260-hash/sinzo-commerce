"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";

type Conv = { waId: string; name: string | null; last: string; lastAt: string; lastDirection: string; count: number; inbound: number; order?: { id: number; code: string; name: string; status: string } | null };
type Msg = { id: number; waId: string; direction: string; body: string; status: string; createdAt: string };
type Order = { id: number; code: string; name: string; status: string; total: number };

const QUICK = [
  "Apunake dhonnobad! Apnar order ti process hocche, 1-2 din er moddhe dispatch hobe.",
  "Parcel ta aj courier-e deya hoyeche. Tracking number shiggiri pathacchi.",
  "Size/colour change korte chan? Amake bolun, stock thakle change kore debo.",
  "Delivery address ta confirm korben please?",
];

export default function InboxClient({ initialConversations, status, autoReply }: { initialConversations: Conv[]; status: { running: boolean; connected: boolean; me?: string | null }; autoReply: string }) {
  const [convs, setConvs] = useState<Conv[]>(initialConversations);
  const [active, setActive] = useState<string | null>(initialConversations[0]?.waId || null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [live, setLive] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = async () => {
    const r = await afetch("/api/admin/inbox");
    const j = await r.json().catch(() => ({}));
    if (r.ok) setConvs(j.conversations || []);
  };
  const loadThread = async (wa: string) => {
    const r = await afetch("/api/admin/inbox?wa=" + encodeURIComponent(wa));
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMessages(j.rows || []); setOrders(j.orders || []); }
  };

  useEffect(() => { if (active) loadThread(active); }, [active]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { loadList(); if (active) loadThread(active); }, 20000);
    return () => clearInterval(t);
  }, [live, active]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !text.trim()) return;
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: active, body: text }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: j.error || "Send failed", ok: false }); return; }
    setText(""); setMsg({ text: "Sent ✓", ok: true });
    loadThread(active); loadList();
  };

  const link = async () => {
    if (!active) return;
    const code = prompt("Order code din (SZ-1042):");
    if (!code) return;
    const r = await afetch("/api/admin/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link", wa: active, orderCode: code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ text: j.error || "Link failed", ok: false }); return; }
    setMsg({ text: `Linked to ${j.order.code} ✓`, ok: true });
    loadThread(active); loadList();
  };

  const shown = convs.filter((c) => !filter || (c.waId + " " + (c.name || "") + " " + (c.order?.code || "")).toLowerCase().includes(filter.toLowerCase()));
  const cur = convs.find((c) => c.waId === active);
  const local = (wa: string) => (wa.startsWith("880") ? "0" + wa.slice(3) : wa);

  return (
    <>
      {!status.connected && (
        <div className="noti err" style={{ marginBottom: 14 }}>
          {status.running
            ? "Bridge chalche kintu WhatsApp linked na — Marketing page the QR scan kore link korun. Ekhon reply pathate gele fail korbe."
            : "Bridge service off — server-e `npm run wa` chalan (WA_BRIDGE_PORT 3001 dev server-e busy thakle onno port din)."}
        </div>
      )}

      <div className="wa-wrap">
        <div className="acard wa-list">
          <div className="acard-h"><h3>Conversations</h3><label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> live
          </label></div>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search number / order…" style={{ width: "100%", padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
          </div>
          <div className="wa-list-body">
            {shown.length === 0 ? <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>Kono conversation nei. Customer message pathale ekhane ashbe.</div> : shown.map((c) => (
              <button key={c.waId} className={"wa-conv" + (c.waId === active ? " on" : "")} onClick={() => setActive(c.waId)}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{c.name || local(c.waId)}</b>
                  <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(c.lastAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>{local(c.waId)}{c.order ? ` · ${c.order.code}` : ""}</div>
                <div className="wa-conv-last" style={{ color: c.lastDirection === "OUT" ? "var(--muted)" : undefined }}>
                  {c.lastDirection === "OUT" ? "You: " : ""}{c.last}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="acard wa-thread">
          {!active ? <div style={{ padding: 20, color: "var(--muted)" }}>Ekta conversation select korun.</div> : (
            <>
              <div className="acard-h">
                <h3>{cur?.name || local(active)}</h3>
                <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
                  {cur?.order ? <a href={`/admin/orders/${cur.order.id}`}>{cur.order.code} · {cur.order.status}</a> : <button className="abtn sm" onClick={link}>Link order</button>}
                  <a className="abtn sm" href={`https://wa.me/${active}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>
                </span>
              </div>
              <div className="wa-thread-body">
                {messages.map((m) => (
                  <div key={m.id} className={"wa-msg " + (m.direction === "OUT" ? "out" : "in")} title={new Date(m.createdAt).toLocaleString("en-GB")}>
                    {m.body}
                    {m.status === "failed" && <div style={{ fontSize: 10.5, color: "var(--danger)" }}>send failed</div>}
                  </div>
                ))}
                {messages.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Ei thread e kono message nei.</div>}
                <div ref={endRef} />
              </div>
              <form className="wa-reply" onSubmit={send}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={status.connected ? "Reply likhun…" : "Bridge off — reply pathate parbena"} />
                <button className="abtn primary" type="submit" disabled={busy || !text.trim()}>{busy ? "…" : "Send"}</button>
              </form>
              <div className="wa-quick">
                {QUICK.map((q) => <button key={q} className="abtn sm" onClick={() => setText(q)} type="button">{q.slice(0, 26)}…</button>)}
              </div>
              {(msg || autoReply) && (
                <div className={"noti " + (msg ? (msg.ok ? "ok" : "err") : "")} style={{ margin: "8px 12px 12px" }}>
                  {msg ? msg.text : `Auto-reply on: “${autoReply.slice(0, 80)}”`}
                </div>
              )}
              {orders.length > 0 && (
                <div style={{ padding: "0 12px 12px", fontSize: 12, color: "var(--muted)" }}>
                  Ei number er order: {orders.map((o) => <a key={o.id} href={`/admin/orders/${o.id}`} style={{ marginRight: 8 }}>{o.code}</a>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
