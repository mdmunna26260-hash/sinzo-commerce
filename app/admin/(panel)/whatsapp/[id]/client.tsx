"use client";
import { afetch } from "@/lib/afetch";
import { useCallback, useEffect, useState } from "react";

/* One campaign's report — polls while the campaign is live, so the owner can watch it go out. */

type Report = {
  broadcast: {
    id: number; name: string; body: string; status: string; total: number; enqueued: number; sent: number; failed: number; skipped: number;
    scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; lastError: string | null; couponCode: string | null;
    linkSlug: string | null; linkTarget: string | null; createdAt: string; images: string | null; productIds: string | null;
  };
  counts: { queued: number; sending: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
  failedRows: { id: number; toWaId: string; error: string | null; attempts: number }[];
  clicks: { slug: string; target: string; clicks: number; lastClickAt: string | null } | null;
  attributed: { count: number; revenue: number; recent: { code: string; name: string; total: number; status: string; createdAt: string }[] };
  audience: { total: number; remaining: number; description: string; excluded: Record<string, number> };
  messages: { id: number; toWaId: string; status: string; error: string | null; attempts: number; queuedAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; mediaJson: string | null }[];
};

const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const pretty = (wa: string) => (wa || "").replace(/^880/, "0").replace(/\D/g, "");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const PILL: Record<string, string> = {
  QUEUED: "PENDING", SENDING: "PROCESSING", SENT: "SHIPPED", DELIVERED: "DELIVERED", READ: "PAID", FAILED: "FAILED", SKIPPED: "ON_HOLD",
};

export default function ReportClient({ id }: { id: number }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await afetch(`/api/admin/whatsapp/broadcasts/${id}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { setErr(j.error || "Report load hoy ni"); return; }
    setErr(""); setR(j as Report);
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!r || ["RUNNING", "SCHEDULED"].includes(r.broadcast.status)) load(); }, 10000);
    return () => clearInterval(t);
  }, [load, r]);

  const act = async (action: string) => {
    setBusy(action); setMsg(null);
    const res = await afetch("/api/admin/whatsapp/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    const j = await res.json().catch(() => ({}));
    setBusy(""); load();
    if (!res.ok || j.error) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    const t = j.tick;
    setMsg({
      ok: true,
      text: action === "retryFailed" ? `${j.requeued || 0} ta message abar queue-te` :
        action === "start" ? "Campaign shuru hoyeche" :
          action === "pause" ? "Campaign thamiye deya hoyeche" : "Done" + (t ? ` · tick: sent ${t.sent}` : "") + " ✓",
    });
  };

  if (err) return <div className="noti err">{err}</div>;
  if (!r) return <div className="acard"><div className="acard-b">Loading…</div></div>;

  const b = r.broadcast;
  const c = r.counts;
  const done = c.sent + c.delivered + c.read + c.failed + c.skipped;
  const pct = b.total ? Math.min(100, Math.round((done / b.total) * 100)) : 0;
  const reached = c.sent + c.delivered + c.read;
  const delivered = c.delivered + c.read;
  const images = (() => { try { return JSON.parse(b.images || "[]") as string[]; } catch { return []; } })();

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>{b.name}</h1>
          <div className="who">
            #{b.id} · {b.status} · {b.total} target · shuru {when(b.startedAt || b.createdAt)}
            {b.finishedAt ? ` · shesh ${when(b.finishedAt)}` : ""}
            {b.scheduledAt && b.status === "SCHEDULED" ? ` · schedule ${when(b.scheduledAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="abtn" href="/admin/whatsapp">← Campaigns</a>
          <a className="abtn" href={`/api/admin/whatsapp/broadcasts/${b.id}?format=csv`}>CSV download</a>
          {["DRAFT", "SCHEDULED", "FAILED"].includes(b.status) && <button className="abtn primary" disabled={busy === "start"} onClick={() => act("start")}>Start</button>}
          {b.status === "RUNNING" && <button className="abtn" disabled={busy === "pause"} onClick={() => act("pause")}>Pause</button>}
          {b.status === "PAUSED" && <button className="abtn primary" disabled={busy === "resume"} onClick={() => act("resume")}>Resume</button>}
          {c.failed > 0 && <button className="abtn" disabled={busy === "retryFailed"} onClick={() => act("retryFailed")}>Retry only failed</button>}
          <a className="abtn" href="/admin/whatsapp/new">New campaign</a>
        </div>
      </div>

      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 14 }}>{msg.text}</div>}
      {b.lastError && <div className="noti err" style={{ marginBottom: 14 }}>{b.lastError}</div>}

      <div className="kpis kpis-6" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Progress</div><div className="k-val">{pct}%</div><div className="k-sub">{done}/{b.total} processed</div></div>
        <div className="kpi"><div className="k-label">Queue-e</div><div className="k-val">{c.queued + c.sending}</div><div className="k-sub">{b.total - b.enqueued} ekhono tairi hoy nai</div></div>
        <div className="kpi"><div className="k-label">Sent</div><div className="k-val">{reached}</div><div className="k-sub">device theke beriyechhe</div></div>
        <div className="kpi"><div className="k-label">Delivered</div><div className="k-val">{c.delivered + c.read}</div><div className="k-sub">{c.read} read</div></div>
        <div className="kpi"><div className="k-label">Failed</div><div className="k-val">{c.failed}</div><div className="k-sub">{c.skipped} skipped</div></div>
        <div className="kpi"><div className="k-label">Link clicks</div><div className="k-val">{r.clicks?.clicks ?? 0}</div><div className="k-sub">{reached ? `${Math.round(((r.clicks?.clicks ?? 0) / Math.max(1, reached)) * 100)}% of sent` : "—"}</div></div>
      </div>

      <div style={{ height: 8, background: "#eceff3", borderRadius: 5, overflow: "hidden", marginBottom: 18 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: c.failed ? "#c0392b" : "#1f7a44", transition: "width .4s" }} />
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginBottom: 16  }}>
        <div className="acard">
          <div className="acard-h"><h3>Attributed orders</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>campaign-er por order koreche</span></div>
          <div className="acard-b">
            <div style={{ fontSize: 26, fontWeight: 700 }}>{r.attributed.count} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>order · {money(r.attributed.revenue)}</span></div>
            {r.attributed.recent.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>
                Ekhono keu order kore nai. (Campaign shuru-r por ja order hoy, ar recipient-der number theke ashe — seta ekhane count hoy.)
              </div>
            ) : (
              <div className="tbl-scroll">
              <table className="tbl" style={{ fontSize: 12.5, marginTop: 8 }}>
                <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>
                  {r.attributed.recent.map((o) => (
                    <tr key={o.code}>
                      <td><a href={`/admin/orders?q=${o.code}`}>{o.code}</a></td>
                      <td>{o.name}</td>
                      <td>{money(o.total)}</td>
                      <td>{o.status}</td>
                      <td style={{ color: "var(--muted)" }}>{when(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Message</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{b.linkSlug ? `/l/${b.linkSlug}` : "no short link"}</span></div>
          <div className="acard-b">
            {images.length > 0 && (
              <div className="wa2-thumbs" style={{ marginBottom: 10 }}>
                {images.slice(0, 6).map((u) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={u} src={u} alt="" className="wa2-thumb" style={{ objectFit: "cover" }} />)}
              </div>
            )}
            <div className="wa2-phone"><div className="wa2-bubble"><div className="wa2-text">{b.body}</div></div></div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Target: {r.audience.description} · {r.audience.total} jon
              {b.couponCode ? ` · coupon ${b.couponCode}` : ""}
              {r.clicks ? <> · <a href={r.clicks.target} target="_blank" rel="noreferrer">link target</a></> : null}
            </div>
          </div>
        </div>
      </div>

      {r.failedRows.length > 0 && (
        <div className="acard" style={{ marginBottom: 16 }}>
          <div className="acard-h"><h3>Failures ({c.failed})</h3><button className="abtn sm" disabled={busy === "retryFailed"} onClick={() => act("retryFailed")}>Retry only failed</button></div>
          <div className="acard-b" style={{ maxHeight: 260, overflow: "auto" }}>
            <div className="tbl-scroll">
            <table className="tbl" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Number</th><th>Tries</th><th>Error</th></tr></thead>
              <tbody>
                {r.failedRows.map((f) => (
                  <tr key={f.id}><td>{pretty(f.toWaId)}</td><td>{f.attempts}</td><td style={{ color: "var(--danger)" }}>{(f.error || "").slice(0, 160)}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      <div className="acard">
        <div className="acard-h"><h3>Recipients ({r.messages.length} recent)</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>शेष {r.audience.remaining} queue-te jabe</span></div>
        <div className="acard-b" style={{ maxHeight: 420, overflow: "auto" }}>
          <div className="tbl-scroll">
          <table className="tbl" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Number</th><th>Status</th><th>Photos</th><th>Tries</th><th>Queued</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Error</th></tr></thead>
            <tbody>
              {r.messages.map((m) => {
                let n = 0;
                try { n = (JSON.parse(m.mediaJson || "[]") as string[]).length; } catch { /* ignore */ }
                return (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{pretty(m.toWaId)}</td>
                    <td><span className={"pill " + (PILL[m.status] || "ON_HOLD")}>{m.status}</span></td>
                    <td>{n || "—"}</td>
                    <td>{m.attempts}</td>
                    <td style={{ color: "var(--muted)" }}>{when(m.queuedAt)}</td>
                    <td style={{ color: "var(--muted)" }}>{when(m.sentAt)}</td>
                    <td style={{ color: "var(--muted)" }}>{when(m.deliveredAt)}</td>
                    <td style={{ color: "var(--muted)" }}>{when(m.readAt)}</td>
                    <td style={{ color: "var(--danger)", maxWidth: 200 }}>{m.error ? m.error.slice(0, 90) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </>
  );
}
