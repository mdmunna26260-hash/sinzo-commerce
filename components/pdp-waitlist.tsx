"use client";
import { useState } from "react";

/* The sold-out PDP used to be a full stop. Now it collects a phone/email and the shop
   pings them the moment the size is back on the shelf. */
export default function PdpWaitlist({ productId, variantId, title }: { productId: number; variantId?: number | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/waitlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, variantId: variantId || undefined, contact, note }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Could not save — try again."); return; }
    setDone(j.message || "Done!");
  };

  if (done) return <div className="waitlist done"><b>✓</b> {done}</div>;

  return (
    <div className="waitlist">
      {!open ? (
        <button type="button" className="waitlist-cta" onClick={() => setOpen(true)}>
          <span>🔔</span> Notify me when <b>{title}</b> is back
        </button>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="wl-contact">Phone ba email — stock ele janabo</label>
          <div className="waitlist-row">
            <input id="wl-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="01712 345678 / you@example.com" required autoCapitalize="none" inputMode="tel" />
            <button className="btn" type="submit" disabled={busy}>{busy ? "…" : "Notify me"}</button>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kono size/color preference? (optional)" style={{ marginTop: 8 }} />
          <div className="waitlist-hint">Size ta fire ele ekta WhatsApp/SMS pathabo — spam korbo na.</div>
          {err && <div className="waitlist-err">{err}</div>}
        </form>
      )}
    </div>
  );
}
