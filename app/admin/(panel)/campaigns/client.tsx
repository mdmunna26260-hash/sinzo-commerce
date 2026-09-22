"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Campaign = {
  id: number; subject: string; body: string; ctaLabel: string | null; ctaUrl: string | null;
  status: string; total: number; sent: number; failed: number; createdAt: string; sentAt: string | null;
};

const EMPTY = { id: 0, subject: "", body: "", ctaLabel: "", ctaUrl: "" };

/* Newsletter composer + sender.
   Sending is deliberately a loop of small requests: each POST sends one batch and reports how
   many addresses are left, so the browser shows real progress and a long list never turns into
   one request that times out half-way. The server refuses to re-send a finished campaign. */
export default function CampaignClient({ campaigns, audience, unsubscribed, myEmail }: { campaigns: Campaign[]; audience: number; unsubscribed: number; myEmail: string }) {
  const router = useRouter();
  const [e, setE] = useState<typeof EMPTY>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const set = (k: string, v: any) => setE((p) => ({ ...p, [k]: v }));

  const save = async (): Promise<number | null> => {
    if (!e.subject.trim() || !e.body.trim()) { setMsg({ text: "Subject and body are both needed.", ok: false }); return null; }
    const r = e.id
      ? await afetch(`/api/admin/campaigns/${e.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) })
      : await afetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...e, action: "save" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Could not save", ok: false }); return null; }
    setE((p) => ({ ...p, id: j.campaign.id }));
    router.refresh();
    return j.campaign.id as number;
  };

  const saveDraft = async () => {
    setBusy(true); setMsg(null);
    const id = await save();
    setBusy(false);
    if (id) setMsg({ text: "Draft saved. Send a test to yourself before it goes to the list.", ok: true });
  };

  const sendTest = async () => {
    if (!e.subject.trim() || !e.body.trim()) { setMsg({ text: "Subject and body are both needed.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...e, action: "test" }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok && j.ok ? { text: `Test sent to ${j.to}. Check the inbox (and the spam folder).`, ok: true } : { text: j.error || "Test failed", ok: false });
  };

  const sendAll = async () => {
    const id = await save();
    if (!id) return;
    if (!confirm(`Send "${e.subject}" to ${audience} subscriber${audience === 1 ? "" : "s"} now?`)) return;
    setBusy(true); setMsg(null);
    let total = 0, failed = 0, done = false, guard = 0;
    while (!done && guard++ < 200) {
      const r = await afetch(`/api/admin/campaigns/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setBusy(false); setProgress(null); setMsg({ text: j.error || "Send failed", ok: false }); router.refresh(); return; }
      total += j.sent || 0; failed += j.failed || 0; done = !!j.done;
      setProgress(done ? null : `Sending… ${total} delivered, ${j.remaining} to go`);
    }
    setBusy(false); setProgress(null);
    setMsg({ text: `Sent to ${total} address${total === 1 ? "" : "es"}${failed ? ` · ${failed} failed` : ""}.`, ok: !failed });
    setE(EMPTY);
    router.refresh();
  };

  const resume = async (c: Campaign) => {
    setBusy(true); setMsg(null);
    let total = 0, done = false, guard = 0;
    while (!done && guard++ < 200) {
      const r = await afetch(`/api/admin/campaigns/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setBusy(false); setProgress(null); setMsg({ text: j.error || "Send failed", ok: false }); return; }
      total += j.sent || 0; done = !!j.done;
      setProgress(done ? null : `Sending… ${total} more sent, ${j.remaining} to go`);
    }
    setBusy(false); setProgress(null);
    setMsg({ text: `Finished — ${total} more sent.`, ok: true });
    router.refresh();
  };

  const edit = (c: Campaign) => {
    setE({ id: c.id, subject: c.subject, body: c.body, ctaLabel: c.ctaLabel || "", ctaUrl: c.ctaUrl || "" });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* Duplicate = a fresh DRAFT with the same words. It must NOT carry the old row's id:
     a SENT campaign refuses to be sent again, so keeping the id made the next save fail. */
  const duplicate = (c: Campaign) => {
    setE({ ...EMPTY, subject: c.subject, body: c.body, ctaLabel: c.ctaLabel || "", ctaUrl: c.ctaUrl || "" });
    setMsg({ text: `Copied "${c.subject}" into a new draft — edit, then send.`, ok: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (c: Campaign) => {
    if (!confirm(`Delete the campaign "${c.subject}"? Sends already made are not affected.`)) return;
    setBusy(true);
    await afetch(`/api/admin/campaigns/${c.id}`, { method: "DELETE" });
    setBusy(false);
    if (e.id === c.id) setE(EMPTY);
    router.refresh();
  };

  const words = e.body.trim() ? e.body.trim().split(/\s+/).length : 0;

  return (
    <>
      <div className="acard" style={{ marginBottom: 18 }}>
        <div className="acard-h"><h3>{e.id ? `Editing campaign #${e.id}` : "New campaign"}</h3>{e.id > 0 && <button className="abtn sm" onClick={() => setE(EMPTY)}>Start a new one</button>}</div>
        <div className="acard-b form-grid">
          <div className="af" style={{ gridColumn: "1 / -1" }}>
            <label>Subject line</label>
            <input value={e.subject} onChange={(ev) => set("subject", ev.target.value)} placeholder="e.g. Winter drop ta eshe gese — 20% off ei week e" />
          </div>
          <div className="af" style={{ gridColumn: "1 / -1" }}>
            <label>Message — blank line = new paragraph, a line starting with ## becomes a heading</label>
            <textarea value={e.body} onChange={(ev) => set("body", ev.target.value)} rows={12} style={{ fontFamily: "inherit", lineHeight: 1.65 }} placeholder={"Notun winter collection eshe gese.\n\n## Ki ache notun\n\nHeavy jackets, wool coats ar knit sweaters — sob Cash on Delivery."} />
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{words} words · the footer with the unsubscribe link is added automatically</div>
          </div>
          <div className="af">
            <label>Button text (optional)</label>
            <input value={e.ctaLabel} onChange={(ev) => set("ctaLabel", ev.target.value)} placeholder="Shop now" />
          </div>
          <div className="af">
            <label>Button link</label>
            <input value={e.ctaUrl} onChange={(ev) => set("ctaUrl", ev.target.value)} placeholder="https://sinzooffcial.com/products" />
          </div>
          <div className="full" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="abtn" disabled={busy} onClick={saveDraft}>Save draft</button>
            <button className="abtn" disabled={busy} onClick={sendTest}>Send test to {myEmail}</button>
            <button className="abtn primary" disabled={busy || audience === 0} onClick={sendAll}>
              {busy && <span className="spinner" aria-hidden="true" />} Send to {audience} subscriber{audience === 1 ? "" : "s"}
            </button>
            {progress && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{progress}</span>}
            {msg && <span style={{ fontSize: 12.5, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
          </div>
        </div>
      </div>

      {audience === 0 && (
        <div className="cfg-note" style={{ marginBottom: 18 }}>
          No reachable subscribers yet — the newsletter form in the site footer fills this list.{" "}
          {unsubscribed > 0 && <>{unsubscribed} address{unsubscribed === 1 ? " has" : "es have"} unsubscribed and will not be mailed.</>}
        </div>
      )}

      <div className="acard">
        <div className="acard-h">
          <h3>Sent campaigns</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {audience} reachable · {unsubscribed} unsubscribed ·{" "}
            <a href="/api/admin/export?type=subscribers" style={{ textDecoration: "underline" }}>CSV</a>
          </span>
        </div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {campaigns.length === 0 ? <div style={{ color: "var(--muted)" }}>Nothing sent yet.</div> : (
            <table className="tbl">
              <thead><tr><th>Subject</th><th>Status</th><th>Delivered</th><th>Failed</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td style={{ maxWidth: 320 }}>{c.subject}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>#{c.id} · {c.total} in the list</div></td>
                    <td><span className={"pill " + (c.status === "SENT" ? "ACTIVE" : c.status === "SENDING" ? "PROCESSING" : "DRAFT")}>{c.status}</span></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.sent}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: c.failed ? "var(--danger)" : "var(--muted)" }}>{c.failed || "—"}</td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(c.sentAt || c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {c.status === "SENT"
                        ? <button className="abtn sm" onClick={() => duplicate(c)}>Duplicate</button>
                        : c.status === "SENDING"
                          ? <button className="abtn sm primary" disabled={busy} onClick={() => resume(c)}>Resume</button>
                          : <>
                              <button className="abtn sm" onClick={() => edit(c)}>Edit</button>{" "}
                              <button className="abtn sm primary" disabled={busy} onClick={() => resume(c)}>Send</button>{" "}
                            </>}
                      {" "}<button className="abtn sm" disabled={busy} onClick={() => del(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
