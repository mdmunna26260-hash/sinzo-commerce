"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Cfg = { enabled: boolean; earnPer100: number; redeemPoints: number; referralPoints: number; minRedeem: number };
type Top = { id: number; name: string; phone: string; points: number; code: string };
type Ref = { id: number; name: string; phone: string; rewarded: boolean; referrer: string };

export default function LoyaltyClient({ cfg, top, referrals, backfill }: { cfg: Cfg; top: Top[]; referrals: Ref[]; backfill: number }) {
  const router = useRouter();
  const [form, setForm] = useState<Cfg>(cfg);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [adjust, setAdjust] = useState<{ id: number; points: string; note: string } | null>(null);

  const call = async (body: any) => {
    const r = await afetch("/api/admin/loyalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, j: await r.json().catch(() => ({})) };
  };

  const saveCfg = async () => {
    setBusy("cfg"); setMsg(null);
    const { ok, j } = await call({ action: "settings", ...form });
    setBusy("");
    setMsg(ok ? { text: "Settings saved ✓", ok: true } : { text: j.error || "Failed", ok: false });
    router.refresh();
  };

  const doAdjust = async () => {
    if (!adjust) return;
    setBusy("adjust"); setMsg(null);
    const { ok, j } = await call({ action: "adjust", customerId: adjust.id, points: Number(adjust.points), note: adjust.note });
    setBusy("");
    if (ok) { setMsg({ text: `Points updated ✓ (balance ${j.points})`, ok: true }); setAdjust(null); router.refresh(); }
    else setMsg({ text: j.error || "Failed", ok: false });
  };

  const redeem = async (c: Top) => {
    const spend = Math.max(form.minRedeem, Math.floor(c.points / form.redeemPoints) * form.redeemPoints);
    if (!confirm(`${c.name} (${c.phone}) er ${spend} points theke ৳${Math.floor(spend / form.redeemPoints) * 100} coupon banabo?`)) return;
    setBusy("redeem" + c.id); setMsg(null);
    const { ok, j } = await call({ action: "redeem", customerId: c.id, points: spend });
    setBusy("");
    if (ok) { setMsg({ text: `Coupon ${j.code} banano hoyeche (৳${j.value}) — customer ke pathiye din ✓`, ok: true }); router.refresh(); }
    else setMsg({ text: j.error || "Failed", ok: false });
  };

  const run = async (action: "backfill" | "codes") => {
    setBusy(action); setMsg(null);
    const { ok, j } = await call({ action, limit: 25 });
    setBusy("");
    if (!ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    setMsg({
      text: action === "backfill"
        ? `${j.awarded} delivered order e points gelo${j.skipped ? `, ${j.skipped} already chilo` : ""} ✓ — bar bar chalan por puro hobe.`
        : `${j.generated} customer er referral code banano hoyeche ✓`,
      ok: true,
    });
    router.refresh();
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16, alignItems: "start", marginBottom: 16 }}>
        <div className="acard">
          <div className="acard-h"><h3>Programme settings</h3><span className={"risk-badge " + (form.enabled ? "risk-LOW" : "risk-HIGH")}>{form.enabled ? "ON" : "OFF"}</span></div>
          <div className="acard-b">
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Points + referral active
            </label>
            <div className="form-grid">
              <div className="af"><label>Points per ৳100 spent</label><input type="number" value={form.earnPer100} onChange={(e) => setForm({ ...form, earnPer100: Number(e.target.value) })} /></div>
              <div className="af"><label>Points = ৳100 off</label><input type="number" value={form.redeemPoints} onChange={(e) => setForm({ ...form, redeemPoints: Number(e.target.value) })} /></div>
              <div className="af"><label>Referral bonus (each side)</label><input type="number" value={form.referralPoints} onChange={(e) => setForm({ ...form, referralPoints: Number(e.target.value) })} /></div>
              <div className="af"><label>Minimum points to redeem</label><input type="number" value={form.minRedeem} onChange={(e) => setForm({ ...form, minRedeem: Number(e.target.value) })} /></div>
            </div>
            <button className="abtn primary" style={{ marginTop: 10 }} onClick={saveCfg} disabled={busy === "cfg"}>{busy === "cfg" ? "…" : "Save settings"}</button>

            <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <b style={{ fontSize: 13 }}>Start the programme on old orders</b>
              <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                {backfill === 0 ? "Every delivered order already earned its points." : `${backfill} delivered order ekhono points pay ni.`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="abtn" onClick={() => run("backfill")} disabled={!!busy || backfill === 0}>{busy === "backfill" ? "…" : "Backfill points (25/run)"}</button>
                <button className="abtn" onClick={() => run("codes")} disabled={!!busy}>{busy === "codes" ? "…" : "Generate missing referral codes"}</button>
              </div>
            </div>

            {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginTop: 12 }}>{msg.text}</div>}
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Top members</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>points balance</span></div>
          <div className="acard-b" style={{ overflowX: "auto" }}>
            {top.length === 0 ? <div style={{ color: "var(--muted)" }}>Kono customer e ekhono points nei — ekta order delivered hole points joma hobe.</div> : (
              <table className="tbl">
                <thead><tr><th>Customer</th><th>Points</th><th>≈ Value</th><th>Referral code</th><th></th></tr></thead>
                <tbody>
                  {top.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.phone}</div></td>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{c.points}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>৳{Math.floor(c.points / form.redeemPoints) * 100}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{c.code || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="abtn sm" onClick={() => setAdjust({ id: c.id, points: "", note: "" })}>Adjust</button>{" "}
                        <button className="abtn sm primary" disabled={busy === "redeem" + c.id || c.points < form.minRedeem} onClick={() => redeem(c)}>Make coupon</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {adjust && (
              <div style={{ marginTop: 14, border: "1px dashed var(--line)", borderRadius: 8, padding: 12 }}>
                <b style={{ fontSize: 13 }}>Adjust points</b>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input type="number" value={adjust.points} onChange={(e) => setAdjust({ ...adjust, points: e.target.value })} placeholder="+50 / -20" style={{ width: 110, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
                  <input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} placeholder="Reason (goodwill, correction…)" style={{ flex: 1, minWidth: 180, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
                  <button className="abtn primary" onClick={doAdjust} disabled={busy === "adjust" || !adjust.points}>Save</button>
                  <button className="abtn" onClick={() => setAdjust(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="acard">
        <div className="acard-h"><h3>Referrals</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>who invited whom</span></div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {referrals.length === 0 ? <div style={{ color: "var(--muted)" }}>Ekhono keu referral code use kore order kore ni. Checkout-e “Friend&rsquo;s referral code” box ta ache.</div> : (
            <table className="tbl">
              <thead><tr><th>Friend (new customer)</th><th>Invited by</th><th>Bonus</th><th>When</th></tr></thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.phone}</div></td>
                    <td>{r.referrer}</td>
                    <td>{r.rewarded ? <span className="pill DELIVERED">paid</span> : <span className="pill PENDING">waiting delivery</span>}</td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.rewarded ? "credited" : "—"}</td>
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
