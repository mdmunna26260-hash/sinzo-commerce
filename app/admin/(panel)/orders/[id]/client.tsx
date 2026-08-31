"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function ThermalLink({ orderId, token }: { orderId: number; token: string }) {
  const [w, setW] = useState("80");
  useEffect(() => {
    try {
      afetch("/api/admin/settings")
        .then((r) => r.json())
        .then((j) => { const tw = j?.settings?.shipping?.thermalWidth; if (tw) setW(String(tw)); })
        .catch(() => {});
    } catch {}
  }, [token]);
  return <Link className="abtn" href={withToken("/admin/orders/" + orderId + "/receipt?w=" + w)}>🧾 Thermal ({w}mm)</Link>;
}

type Order = any;
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];

/* Courier fraud check card: provider report (Steadfast/Pathao/RedX/… delivery
   history via FraudBD-compatible API) + our own store history (always real).
   On-demand only — one API call per click, spinner state, honest errors. */
function FraudCheck({ orderId, phone }: { orderId: number; phone: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const r = await afetch(`/api/admin/orders/${orderId}/fraudcheck`, { method: "POST" });
      const j = await r.json();
      if (r.ok) setRes(j); else setErr(j.error || "Check failed");
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  const tone = (rate?: number, risk?: string) => {
    if (risk === "high" || (rate != null && rate < 50)) return "risk-HIGH";
    if (risk === "medium" || (rate != null && rate < 75)) return "risk-MEDIUM";
    return "risk-LOW";
  };

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div className="acard-h">
        <h3>🛡️ Courier Fraud Check — {phone}</h3>
        <button className="abtn" onClick={run} disabled={busy} aria-busy={busy || undefined}>
          {busy && <span className="spinner" aria-hidden="true" />} {busy ? "Checking…" : res ? "Check again" : "Check courier history"}
        </button>
      </div>
      {err && <div className="acard-b" style={{ paddingTop: 12 }}><div className="noti err">{err}</div></div>}
      {!res && !err && (
        <div className="acard-b" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Courier delivery history (Steadfast / Pathao / RedX / Paperfly) + apnar nijer store-er data — shipping er age check korun. Setup: Settings → Courier.
        </div>
      )}
      {res && (
        <div className="acard-b">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: res.provider?.ok ? 14 : 0 }}>
            <span className="pill DELIVERED">Own store: delivered {res.own.delivered}</span>
            <span className={"pill " + (res.own.cancelled + res.own.returned > 0 ? "CANCELLED" : "DRAFT")}>cancelled {res.own.cancelled} · returned {res.own.returned}</span>
            {res.own.active > 0 && <span className="pill PROCESSING">active {res.own.active}</span>}
            {res.own.successRate != null && <span className={"risk-badge " + tone(res.own.successRate)}>own success {res.own.successRate}%</span>}
          </div>
          {res.provider?.ok ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <span className={"risk-badge " + tone(res.provider.summary?.successRate)}>
                  All couriers: {res.provider.summary?.successRate ?? "—"}% success
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {res.provider.summary?.total ?? 0} deliveries · {res.provider.summary?.success ?? 0} success · {res.provider.summary?.cancel ?? 0} cancel ({res.provider.provider})
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Courier</th><th>Total</th><th>Success</th><th>Cancel</th><th>Success %</th><th>Risk</th></tr></thead>
                <tbody>
                  {(res.provider.couriers || []).map((c: any) => (
                    <tr key={c.name}>
                      <td><b>{c.name}</b></td>
                      <td>{c.total}</td>
                      <td>{c.success}</td>
                      <td>{c.cancel}</td>
                      <td>{c.total ? (c.successRate ?? Math.round((c.success / c.total) * 100)) + "%" : "—"}</td>
                      <td>{c.risk || c.message ? <span className={"risk-badge " + tone(undefined, c.risk)}>{String(c.message || c.risk).replace(/_/g, " ")}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="noti err" style={{ marginTop: 6 }}>
              Provider report: {res.provider?.error || "not configured"} — nijer store-er data upore dekhachhe. API key add korun: Settings → Courier.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OrderDetailClient({ initial }: { initial: Order }) {
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState(o.adminNote || "");
  const [edit, setEdit] = useState({ name: o.name, phone: o.phone, address: o.address });
  const [editing, setEditing] = useState(false);

  const copy = async (label: string, text: string) => {
    const ok = await copyText(text);
    setMsg(ok ? `📋 ${label} copied ✓` : "Copy failed");
    setTimeout(() => setMsg(""), 1800);
  };
  const downloadOrder = () => {
    const L = [];
    L.push("========== ORDER ==========");
    L.push(`Order : ${o.code}`);
    L.push(`Date  : ${new Date(o.createdAt).toLocaleString("en-GB")}`);
    L.push(`Name  : ${o.name}`);
    L.push(`Phone : ${o.phone}`);
    L.push(`Address: ${o.address}`);
    L.push(`Zone  : ${o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}`);
    L.push(`Payment: ${o.paymentMethod}`);
    L.push("--------------------------");
    o.items.forEach((i: any, k: number) => {
      L.push(`${k + 1}. ${i.title}${i.variant ? " (" + i.variant + ")" : ""} x${i.qty} = ৳${Math.round(i.price * i.qty).toLocaleString("en-IN")}`);
    });
    L.push("--------------------------");
    L.push(`Subtotal : ৳${Math.round(o.subtotal).toLocaleString("en-IN")}`);
    if (o.discount > 0) L.push(`Discount : -৳${Math.round(o.discount).toLocaleString("en-IN")}${o.couponCode ? " (" + o.couponCode + ")" : ""}`);
    L.push(`Delivery : ৳${Math.round(o.deliveryFee).toLocaleString("en-IN")}`);
    L.push(`TOTAL    : ৳${Math.round(o.total).toLocaleString("en-IN")} (${o.paymentMethod})`);
    if (o.courierConsignmentId) {
      L.push("==========================");
      L.push(`Courier  : ${o.courierName || "Steadfast"}`);
      L.push(`Consignment ID: ${o.courierConsignmentId}`);
      try { const ct = JSON.parse(o.courierTracking || "{}"); if (ct.tracking_code) L.push(`Tracking  : ${ct.tracking_code}`); } catch {}
    }
    L.push(`Status   : ${o.status}`);
    L.push("==========================");
    const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = o.code + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const put = async (body: any, noteMsg?: string) => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/orders/" + o.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) { setO({ ...o, ...body }); setMsg(noteMsg || "Saved ✓"); router.refresh(); }
    else setMsg(j.error || "Failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 2500);
  };

  const sendCourier = async () => {
    if (!confirm("Send this order to Steadfast courier?")) return;
    setBusy(true); setMsg("");
    const r = await afetch(`/api/admin/orders/${o.id}/courier`, { method: "POST" });
    const j = await r.json();
    if (r.ok) {
      setO({ ...o, courierName: "Steadfast", courierConsignmentId: j.consignment?.consignment_id, courierStatus: j.consignment?.delivery_status });
      setMsg("Sent to Steadfast ✓ " + (j.consignment?.consignment_id || ""));
    } else {
      setMsg(j.configured === false ? "⚠ Steadfast is NOT CONFIGURED — add API keys in Settings > Courier" : "Courier error: " + (j.error || "unknown"));
    }
    setBusy(false);
  };
  const quickBlock = async (type: string, value: string) => {
    if (!value) return;
    if (!confirm(`Blacklist ${type}: ${value}?`)) return;
    setBusy(true);
    const r = await afetch("/api/admin/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, value, note: "manual: from order " + o.code }) });
    setMsg(r.ok ? `🚫 ${type} blacklisted ✓` : "Blacklist failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 3000);
  };

  const trackCourier = async () => {
    setBusy(true); setMsg("");
    const r = await afetch(`/api/admin/orders/${o.id}/courier`);
    const j = await r.json();
    if (r.ok) { setO({ ...o, courierStatus: j.data?.delivery_status || o.courierStatus }); setMsg("Courier status: " + (j.data?.delivery_status || "unknown")); }
    else setMsg(j.configured === false ? "⚠ Steadfast NOT CONFIGURED" : "Courier error: " + (j.error || ""));
    setBusy(false);
  };

  const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>{o.code}</h1>
          <div className="who">Placed <FmtDate iso={o.createdAt} /> · Updated <FmtDate iso={o.updatedAt} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={downloadOrder}>⭳ Download</button>
          <ThermalLink orderId={o.id} token={(() => { try { return new URLSearchParams(location.search).get("t") || localStorage.getItem("sz_admin_token") || ""; } catch { return ""; } })()} />
          <Link className="abtn" href={withToken("/admin/dashboard")}>← Back to Dashboard</Link>
          <Link className="abtn" href={withToken("/admin/orders/" + o.id + "/invoice")} target="_blank">🖨 Invoice</Link>
          {!o.courierConsignmentId
            ? <button className="abtn primary" onClick={sendCourier} disabled={busy}>🚚 Send to Steadfast</button>
            : <button className="abtn" onClick={trackCourier} disabled={busy}>🔄 Refresh courier status</button>}
        </div>
      </div>
      {msg && <div className="noti ok">{msg}</div>}
      {o.riskLevel !== "LOW" && (
        <div className="noti err">⚠ Risk level: <b>{o.riskLevel}</b>{o.riskFlags ? " — " + o.riskFlags : ""} — review before shipping.</div>
      )}
      <FraudCheck orderId={o.id} phone={o.phone} />

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start" }}>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Items</h3></div>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Variant</th><th>Price</th><th>Qty</th><th>Total</th></tr></thead>
              <tbody>
                {o.items.map((i: any) => (
                  <tr key={i.id}>
                    <td>{i.image && <img src={i.image} alt="" style={{ display: "inline", marginRight: 10, verticalAlign: "middle" }} />}{i.title}</td>
                    <td>{i.variant || "—"}</td>
                    <td>{money(i.price)}</td><td>{i.qty}</td><td><b>{money(i.price * i.qty)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="acard-b" style={{ borderTop: "1px solid #eeedea" }}>
              <div className="sum-row"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
              {o.discount > 0 && <div className="sum-row"><span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span><span>−{money(o.discount)}</span></div>}
              <div className="sum-row"><span>Delivery ({o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span><span>{money(o.deliveryFee)}</span></div>
              <div className="sum-row total"><span>Total {o.paymentMethod === "COD" ? "(COD)" : ""}</span><span>{money(o.total)}</span></div>
            </div>
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Customer</h3>{!editing && <button className="abtn sm" onClick={() => setEditing(true)}>Edit</button>}{editing && <button className="abtn sm primary" onClick={() => { put(edit, "Customer updated ✓"); setEditing(false); }} disabled={busy}>Save</button>}</div>
            <div className="acard-b">
              {editing ? (
                <div className="form-grid">
                  <div className="af"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                  <div className="af"><label>Phone</label><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                  <div className="af full"><label>Address</label><textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} style={{ minHeight: 70 }} /></div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>{o.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {o.phone}
                    <button className="abtn sm" title="Copy phone" onClick={() => copy("Phone", o.phone)}>📋</button>
                    {o.email ? <span>{o.email}</span> : null}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>{o.address}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                    Source: <b>{o.source || "Direct"}</b>
                    {o.attribution && (o.attribution.utm_source || o.attribution.fbclid) ? <> · UTM: {o.attribution.utm_source || "—"} / {o.attribution.utm_medium || "—"} {o.attribution.utm_campaign ? "· " + o.attribution.utm_campaign : ""} {o.attribution.fbclid ? "· fbclid ✓" : ""}</> : null}
                    {o.ip ? <> · IP: {o.ip}</> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="abtn sm" disabled={busy} onClick={() => copy("Phone", o.phone)}>📋 Copy phone</button>
                    <a className="abtn sm" style={{ color: "var(--ok)", borderColor: "#c4dfd0", fontWeight: 600 }}
                      href={"https://wa.me/" + (() => { let d = o.phone.replace(/[^0-9]/g, ""); if (d.startsWith("0")) d = "88" + d; else if (!d.startsWith("880")) d = "880" + d; return d; })()}
                      target="_blank" rel="noreferrer">💬 WhatsApp customer</a>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="abtn sm danger" disabled={busy} onClick={() => quickBlock("PHONE", o.phone)}>🚫 Block phone</button>
                    {o.ip && o.ip !== "0.0.0.0" && <button className="abtn sm danger" disabled={busy} onClick={() => quickBlock("IP", o.ip)}>🚫 Block IP</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Fulfillment</h3></div>
            <div className="acard-b">
              <div className="af" style={{ marginBottom: 12 }}>
                <label>Order Status</label>
                <select value={o.status} onChange={(e) => put({ status: e.target.value }, "Status → " + e.target.value)} disabled={busy}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="af" style={{ marginBottom: 12 }}>
                <label>Payment Status</label>
                <select value={o.paymentStatus} onChange={(e) => put({ paymentStatus: e.target.value }, "Payment → " + e.target.value)} disabled={busy}>
                  <option>PENDING</option><option>PAID</option><option>FAILED</option><option>REFUNDED</option>
                </select>
              </div>
              <div className="af">
                <label>Admin Note</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal notes…" style={{ minHeight: 70 }} />
                <button className="abtn sm" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => put({ adminNote: note }, "Note saved ✓")} disabled={busy}>Save note</button>
              </div>
            </div>
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Courier</h3></div>
            <div className="acard-b" style={{ fontSize: 13.5 }}>
              {o.courierName ? (
                <>
                  <div><b>{o.courierName}</b></div>
                  <div style={{ color: "var(--muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    Consignment: {o.courierConsignmentId}
                    <button className="abtn sm" title="Copy consignment ID" onClick={() => copy("Consignment ID", o.courierConsignmentId)}>📋</button>
                  </div>
                  <div style={{ marginTop: 4 }}>Status: <span className="pill SHIPPED">{o.courierStatus || "unknown"}</span></div>
                </>
              ) : (
                <div style={{ color: "var(--muted)" }}>Not sent to any courier yet.</div>
              )}
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                Tracking: {o.code} · {o.phone}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
