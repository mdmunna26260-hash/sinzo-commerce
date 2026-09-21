"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = { id: number; contact: string; note: string | null; notifiedAt: string | null; createdAt: string; productId: number; productTitle: string; stock: number; slug: string };

/* Rows + per-row notify. The API tells us whether it went out over WhatsApp/SMS/email, or
   nothing was configured and here's a wa.me / mailto link to send it by hand. */
export default function WaitlistClient({ rows, productId }: { rows: Row[]; productId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | 0>(0);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");

  const shown = rows.filter((r) => !q || (r.contact + " " + r.productTitle).toLowerCase().includes(q.toLowerCase()));

  const act = async (body: any, id?: number) => {
    setBusy(id || -1); setMsg(null);
    const r = await afetch("/api/admin/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(0);
    if (!r.ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    if (j.ok && j.channel === "manual" && j.link) {
      setMsg({ text: "Auto channel nei — link theke pathan: " + j.link, ok: false });
      window.open(j.link, "_blank");
    } else if (j.candidates !== undefined) {
      setMsg({ text: `${j.sent}/${j.candidates} notified ✓`, ok: true });
    } else {
      setMsg({ text: `Sent via ${j.channel} ✓`, ok: true });
    }
    router.refresh();
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contact / product…" style={{ flex: 1, minWidth: 180, padding: "9px 12px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
        {productId > 0 && (
          <button className="abtn primary" disabled={bulk} onClick={async () => { setBulk(true); await act({ action: "notify_product", productId }); setBulk(false); }}>
            {bulk ? "…" : "Notify everyone waiting"}
          </button>
        )}
      </div>
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 12, wordBreak: "break-word" }}>{msg.text}</div>}

      {shown.length === 0 ? <div style={{ color: "var(--muted)" }}>No entries{q ? " matching that search" : " yet"}.</div> : (
        <table className="tbl">
          <thead><tr><th>Contact</th><th>Product</th><th>Asked</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.contact}</b>{r.note && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.note}</div>}</td>
                <td>
                  <a href={`/admin/waitlist?product=${r.productId}`}>{r.productTitle}</a>
                  <div style={{ fontSize: 11.5, color: r.stock <= 0 ? "var(--ad-red, #b42318)" : "var(--ok)" }}>stock {r.stock}</div>
                </td>
                <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                <td>{r.notifiedAt
                  ? <span className="pill DELIVERED" title={new Date(r.notifiedAt).toLocaleString("en-GB")}>notified</span>
                  : <span className="pill PENDING">waiting</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="abtn sm" disabled={busy === r.id} onClick={() => act({ action: "notify", id: r.id }, r.id)}>{busy === r.id ? "…" : r.notifiedAt ? "Again" : "Notify"}</button>{" "}
                  {!r.notifiedAt && <button className="abtn sm" onClick={() => act({ action: "mark", id: r.id }, r.id)} title="Mark as notified without sending">Mark</button>}{" "}
                  <button className="abtn sm" onClick={() => { if (confirm("Delete this waitlist entry?")) act({ action: "delete", id: r.id }, r.id); }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
