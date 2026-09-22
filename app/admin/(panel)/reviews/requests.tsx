"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Q = { id: number; code: string; name: string; phone: string; total: number; email: string | null; updatedAt: string };

/* Post-delivery review asks. Reviews are the only honest way to fill the star rating Google
   reads, so this card works the delivered-order queue: ask one, or ask the next few. */
export default function ReviewRequests({ queue, autoRequest, asked, pending }: { queue: Q[]; autoRequest: boolean; asked: number; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [auto, setAuto] = useState(autoRequest);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const call = async (body: any) => {
    const r = await afetch("/api/admin/review-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, j: await r.json().catch(() => ({})) };
  };

  const sendOne = async (o: Q) => {
    setBusy(o.code); setMsg(null);
    const { ok, j } = await call({ action: "send", orderId: o.id });
    setBusy("");
    if (ok && j.ok) setMsg({ text: `${o.code}: review request gelo (${j.channel}) ✓`, ok: true });
    else setMsg({ text: `${o.code}: ${j.error || j.skipped || "pathate parlam na"}`, ok: false });
    router.refresh();
  };

  const sendBatch = async (n: number) => {
    setBusy("batch"); setMsg(null);
    const { ok, j } = await call({ action: "send_batch", limit: n });
    setBusy("");
    setMsg(ok ? { text: `${j.sent} request gelo${j.failed ? `, ${j.failed} fail (channel nei?)` : ""} ✓`, ok: true } : { text: j.error || "Batch failed", ok: false });
    router.refresh();
  };

  const toggle = async () => {
    setBusy("auto");
    const { ok, j } = await call({ action: "toggle", autoRequest: !auto });
    setBusy("");
    if (ok) { setAuto(j.autoRequest); setMsg({ text: j.autoRequest ? "Auto review request ON — delivery confirm holei chole jabe." : "Auto review request off.", ok: true }); }
  };

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div className="acard-h">
        <h3>Review requests</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{asked} asked so far · {pending} delivered order{pending === 1 ? "" : "s"} waiting</span>
      </div>
      <div className="acard-b">
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}>
          <input type="checkbox" checked={auto} disabled={busy === "auto"} onChange={toggle} />
          Delivery confirm hole automatic review request pathao (WhatsApp → SMS → email)
        </label>

        {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 12 }}>{msg.text}</div>}

        {queue.length === 0 ? <div style={{ color: "var(--muted)" }}>No delivered order is waiting — sob customer ke already jiggesha kora hoyeche.</div> : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button className="abtn primary" disabled={!!busy} onClick={() => sendBatch(5)}>{busy === "batch" ? "…" : "Ask next 5"}</button>
              <button className="abtn" disabled={!!busy} onClick={() => sendBatch(15)}>Ask next 15</button>
            </div>
            <table className="tbl">
              <thead><tr><th>Order</th><th>Customer</th><th>Delivered</th><th></th></tr></thead>
              <tbody>
                {queue.slice(0, 20).map((o) => (
                  <tr key={o.id}>
                    <td><a href={`/admin/orders/${o.id}`}>{o.code}</a></td>
                    <td>{o.name}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.phone}</div></td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{new Date(o.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td><button className="abtn sm" disabled={busy === o.code} onClick={() => sendOne(o)}>{busy === o.code ? "…" : "Ask for review"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
