"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { afetch, copyText } from "@/lib/afetch";

const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");
const STATUS_PILL: Record<string, string> = { OPEN: "PENDING", RECOVERED: "SHIPPED", CONVERTED: "DELIVERED" };

export default function MarketingClient({ abandoned, subscribers, sources, push, recCouponInit, recSettings }: any) {
  const router = useRouter();
  const [items, setItems] = useState(abandoned);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // ---- push broadcast state ----
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushUrl, setPushUrl] = useState("/");
  const [pushTestPhone, setPushTestPhone] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");

  // ---- abandoned recovery ----
  const [recCoupon, setRecCoupon] = useState(recCouponInit || "");
  const [recBusy, setRecBusy] = useState(false);
  const [recMsg, setRecMsg] = useState("");
  const saveRecCoupon = async () => {
    setRecBusy(true);
    const r = await afetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: "marketing", value: { ...(recSettings || {}), recoveryCoupon: recCoupon.trim() } }) });
    setRecMsg(r.ok ? "Coupon saved ✓" : "Failed");
    setRecBusy(false);
    setTimeout(() => setRecMsg(""), 2500);
  };
  const runRecovery = async () => {
    if (!confirm("Ekhon recovery pass chalaben? 45min+ purano, email-ase, emnei-sob abandoned checkout e 1ta kore email jabe.")) return;
    setRecBusy(true); setRecMsg("Running…");
    const r = await afetch("/api/admin/abandoned-recover", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setRecMsg(r.ok ? `✓ Sent: ${j.sent} · skipped: ${j.skipped} · failed: ${j.failed}` : (j.error || "Failed"));
    setRecBusy(false);
  };

  const open = items.filter((a: any) => a.status === "OPEN");
  const recovered = items.filter((a: any) => a.status !== "OPEN");
  const rate = items.length ? Math.round((recovered.length / items.length) * 100) : 0;

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };

  const copyPhone = async (e: React.MouseEvent, phone?: string | null) => {
    e.stopPropagation();
    if (!phone) { flash("Ei checkout-e phone nai"); return; }
    const ok = await copyText(phone);
    flash(ok ? "📋 " + phone + " copied ✓" : "Copy failed");
  };

  const markRecovered = async (a: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    const r = await afetch("/api/admin/abandoned/" + a.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "RECOVERED" }) });
    if (r.ok) {
      setItems((xs: any[]) => xs.map((x) => x.id === a.id ? { ...x, status: "RECOVERED" } : x));
      flash("✓ Marked as RECOVERED" + (a.phone ? " — phone: " + a.phone : ""));
    } else flash("Failed");
    setBusy(false);
  };

  const takeToOrder = async (a: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Ei abandoned checkout theke real ORDER banaben? (Status: CONFIRMED, COD)")) return;
    setBusy(true);
    const r = await afetch(`/api/admin/abandoned/${a.id}/convert`, { method: "POST" });
    const j = await r.json();
    if (r.ok) {
      setItems((xs: any[]) => xs.map((x) => x.id === a.id ? { ...x, status: "CONVERTED" } : x));
      flash("✓ Order " + j.code + " created — Orders page-e dekhun!");
      router.refresh();
    } else flash(j.error || "Failed");
    setBusy(false);
  };

  const deleteRow = async (a: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this abandoned checkout?")) return;
    setBusy(true);
    const r = await afetch("/api/admin/abandoned/" + a.id, { method: "DELETE" });
    if (r.ok) { setItems((xs: any[]) => xs.filter((x) => x.id !== a.id)); flash("Deleted"); }
    setBusy(false);
  };

  const deleteOld2wk = async () => {
    if (!confirm("2 week+ purano OPEN checkouts delete hobe. Confirm?")) return;
    setBusy(true);
    const r = await afetch("/api/admin/abandoned?olderThanDays=2", { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setItems((xs: any[]) => xs.filter((x) => {
        const age = Date.now() - new Date(x.updatedAt).getTime();
        return !(x.status === "OPEN" && age > 14 * 86400000);
      }));
      flash("✓ " + (j.deleted || 0) + " old checkouts deleted");
      router.refresh();
    } else flash("Failed");
    setBusy(false);
  };

  const sendPush = async (action: "broadcast" | "test") => {
    if (pushBusy) return;
    if (action === "broadcast" && !pushTitle.trim()) { setPushMsg("Title din"); return; }
    if (action === "test" && !pushTestPhone.trim()) { setPushMsg("Test number din"); return; }
    setPushBusy(true); setPushMsg("");
    const r = await afetch("/api/admin/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      action, title: pushTitle.trim(), body: pushBody.trim(), url: pushUrl.trim() || "/",
      phone: pushTestPhone.trim(),
    }) });
    const j = await r.json().catch(() => ({}));
    setPushBusy(false);
    if (r.ok) {
      setPushMsg("✓ " + (j.detail || "Sent"));
      if (action === "broadcast") { setPushTitle(""); setPushBody(""); }
    } else setPushMsg(j.error || "Failed");
    setTimeout(() => setPushMsg(""), 6000);
  };

  /* BD numbers stored as 01XXXXXXXXX — wa.me needs full international format 8801XXXXXXXXX */
  const waLink = (phone?: string | null) => {
    if (!phone) return null;
    let digits = phone.replace(/[^0-9]/g, "");
    if (digits.startsWith("0")) digits = "88" + digits;
    else if (!digits.startsWith("880")) digits = "880" + digits;
    return "https://wa.me/" + digits;
  };

  return (
    <>
      <div className="admin-top"><h1>Marketing &amp; Recovery</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi"><div className="k-label">Abandoned Checkouts</div><div className="k-val">{open.length}</div><div className="k-sub">not recovered</div></div>
        <div className="kpi"><div className="k-label">Recovered</div><div className="k-val">{items.filter((a: any) => a.status === "RECOVERED").length}</div></div>
        <div className="kpi"><div className="k-label">Recovery Rate</div><div className="k-val">{rate}%</div></div>
        <div className="kpi"><div className="k-label">Newsletter Subscribers</div><div className="k-val">{subscribers.length}</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h">
            <h3>Abandoned Checkouts (latest 50)</h3>
            <button className="abtn sm danger" onClick={deleteOld2wk} disabled={busy}>🗑 Delete 2wk+ old</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Items</th><th>Value</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", padding: 30 }}>No abandoned checkouts recorded yet.</td></tr>}
                {items.map((a: any) => (
                  <>
                  <tr key={a.id} className="abandoned-row" style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === a.id ? null : a.id)} title="Tap for details">
                    <td style={{ fontSize: 12.5 }}>{new Date(a.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{a.recoveryEmailedAt ? <div style={{ color: "var(--ok)", fontSize: 10.5 }}>✉ emailed</div> : null}</td>
                    <td style={{ fontSize: 12.5 }}>{a.cart.map((i: any) => i.title + " ×" + i.qty).join(", ").slice(0, 80)}</td>
                    <td><b>{money(a.total)}</b></td>
                    <td><span className={"pill " + (STATUS_PILL[a.status] || "PENDING")}>{a.status}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {a.phone && <button className="abtn sm" title="Copy phone" onClick={(e) => copyPhone(e, a.phone)}>📋</button>}{" "}
                      {a.status === "OPEN" && a.phone && (
                        <a className="abtn sm" style={{ color: "var(--ok)", borderColor: "#c4dfd0" }} href={waLink(a.phone)} target="_blank" rel="noreferrer" title="WhatsApp customer">💬</a>
                      )}{" "}
                      {a.status === "OPEN" && (
                        <>
                          <button className="abtn sm primary" disabled={busy} onClick={(e) => markRecovered(a, e)}>Mark Recovered</button>
                          {a.phone && a.address && (
                            <button className="abtn sm" style={{ color: "var(--accent)", borderColor: "#d9c49a", fontWeight: 600 }} disabled={busy}
                              title="Real order hishebe convert korun" onClick={(e) => takeToOrder(a, e)}>🛒 Take to Order</button>
                          )}
                        </>
                      )}{" "}
                      <button className="abtn sm danger" disabled={busy} onClick={(e) => deleteRow(a, e)}>✕</button>
                    </td>
                  </tr>
                  {expanded === a.id && (
                    <tr key={a.id + "-detail"}>
                      <td colSpan={5} className="ad-row" style={{ padding: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                          <div>
                            <div style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>🛒 Cart Items</div>
                            {a.cart.map((i: any, k: number) => (
                              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f0f2f5", fontSize: 13 }}>
                                <span>{i.title} × {i.qty}</span>
                                <b>{money((i.price || 0) * (i.qty || 1))}</b>
                              </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontWeight: 700 }}>
                              <span>Total</span><span>{money(a.total)}</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>👤 Customer</div>
                            {a.name || a.phone || a.address ? (
                              <div style={{ fontSize: 13.5, display: "grid", gap: 8 }}>
                                {a.name && <div><b>{a.name}</b></div>}
                                {a.email && <div style={{ fontSize: 12.5 }}>✉ {a.email}</div>}
                                {a.phone && (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    📞 <b>{a.phone}</b>
                                    <button className="abtn sm" onClick={(e) => copyPhone(e, a.phone)}>📋 Copy</button>
                                    <a className="abtn sm" style={{ color: "var(--ok)", borderColor: "#c4dfd0", fontWeight: 600 }} href={waLink(a.phone)} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                                  </div>
                                )}
                                {a.address && (
                                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                                    📍 <span>{a.address}</span>
                                    <button className="abtn sm" onClick={(e) => { e.stopPropagation(); copyText(a.address).then(() => flash("📍 Address copied ✓")); }}>📋 Copy</button>
                                  </div>
                                )}
                                {!a.phone && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>⚠ Phone nai — WhatsApp/call kora jabe na</div>}
                              </div>
                            ) : (
                              <div style={{ color: "var(--muted)", fontSize: 13 }}>Checkout form fill kore nai — shudhu cart items ase.</div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Order Sources</h3></div>
            <table className="tbl">
              <thead><tr><th>Source</th><th>Orders</th><th>Revenue</th></tr></thead>
              <tbody>
                {sources.sort((a: any, b: any) => b.revenue - a.revenue).map((s: any) => (
                  <tr key={s.source || "Direct"}><td>{s.source || "Direct"}</td><td>{s.orders}</td><td><b>{money(s.revenue)}</b></td></tr>
                ))}
                {sources.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", padding: 20 }}>No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="acard">
            <div className="acard-h"><h3>Subscribers</h3><a className="abtn sm" href="/api/admin/export?type=subscribers">⭳ CSV</a></div>
            <div className="acard-b" style={{ maxHeight: 300, overflow: "auto", fontSize: 13 }}>
              {subscribers.length === 0 && <span style={{ color: "var(--muted)" }}>No subscribers yet.</span>}
              {subscribers.map((s: any) => <div key={s.id} style={{ padding: "5px 0", borderBottom: "1px solid #f0f2f5" }}>{s.email}</div>)}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Abandoned Cart Recovery ---- */}
      <div className="acard" style={{ marginTop: 16 }}>
        <div className="acard-h">
          <h3>Abandoned Cart Recovery (Email)</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>45min+ purano · OPEN · email thakle 1ta recovery email</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
          <div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Recovery coupon code (optional — email e dekhabe, checkout e apply hobe)</label>
              <input value={recCoupon} onChange={(e) => setRecCoupon(e.target.value.toUpperCase())} placeholder="e.g. COMEBACK10" style={{ textTransform: "uppercase" }} />
            </div>
            <button className="abtn primary" onClick={saveRecCoupon} disabled={recBusy}>Save coupon</button>
          </div>
          <div style={{ borderLeft: "1px solid #eee", paddingLeft: 18 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Kivabe kaj kore: checkout form e customer name/phone/address fill kore chole gele abandoned hishebe save hoy.
              Recovery pass chalale 45min+ purano OPEN checkout gulo te ekta kore reminder email jay (cart items + total + coupon + resume link).
              Prottekta checkout e maximum 1ta email — spam nai.
            </div>
            <button className="abtn primary" onClick={runRecovery} disabled={recBusy} aria-busy={recBusy || undefined}>
              {recBusy && <span className="spinner" aria-hidden="true" />}Run recovery pass now
            </button>
            {recMsg && <div style={{ marginTop: 10, fontSize: 13, color: recMsg.includes("✓") || recMsg.includes("Sent") ? "var(--ok)" : "var(--danger)" }}>{recMsg}</div>}
          </div>
        </div>
      </div>

      {/* ---- Web Push broadcast ---- */}
      <div className="acard" style={{ marginTop: 16 }}>
        <div className="acard-h">
          <h3>Push Notifications</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{push?.total || 0} device(s) · {push?.withPhone || 0} linked to phone</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
          <div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Title</label>
              <input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="e.g. New Arrival — Winter Collection" maxLength={80} />
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Message</label>
              <textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} placeholder="Short message (optional)" rows={2} style={{ minHeight: 0, resize: "vertical" }} maxLength={200} />
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Open URL (optional)</label>
              <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/products" />
            </div>
            <button className="abtn primary" onClick={() => sendPush("broadcast")} disabled={pushBusy} aria-busy={pushBusy || undefined}>
              {pushBusy && <span className="spinner" aria-hidden="true" />}Send to ALL devices
            </button>
          </div>
          <div style={{ borderLeft: "1px solid #eee", paddingLeft: 18 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Kivabe kaj kore: customer order success page theke "Enable" tap korle tar device push subscribe hoy (phone number sathe linked).
              Order status change (CONFIRMED / SHIPPED / DELIVERED / CANCELLED) korle auto push jay. Niche test kore dekhen.
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Test — customer phone</label>
              <input value={pushTestPhone} onChange={(e) => setPushTestPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="numeric" />
            </div>
            <button className="abtn" onClick={() => sendPush("test")} disabled={pushBusy} aria-busy={pushBusy || undefined}>Send test</button>
            {pushMsg && <div style={{ marginTop: 10, fontSize: 13, color: pushMsg.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>{pushMsg}</div>}
          </div>
        </div>
      </div>
      <div style={{ height: 40 }} />
    </>
  );
}
