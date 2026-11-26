"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { orderWhatsAppMessage } from "@/lib/order-whatsapp";
import { telLink, waLink } from "@/lib/phone";

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
  const [repOpen, setRepOpen] = useState(false);
  const [repType, setRepType] = useState("Cancelled order");
  const [repNote, setRepNote] = useState("");
  const [repMsg, setRepMsg] = useState("");
  const [repBusy, setRepBusy] = useState(false);

  const submitReport = async () => {
    setRepBusy(true); setRepMsg("");
    try {
      const r = await afetch("/api/admin/fraud-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, reason: repType, note: repNote }) });
      const j = await r.json();
      setRepMsg(r.ok ? "✓ Report saved — phone auto-blacklisted" : (j.error || "Failed"));
      if (r.ok) { setRepOpen(false); setRepNote(""); }
    } catch { setRepMsg("Network error"); }
    setRepBusy(false);
    setTimeout(() => setRepMsg(""), 4000);
  };

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={run} disabled={busy} aria-busy={busy || undefined}>
            {busy && <span className="spinner" aria-hidden="true" />} {busy ? "Checking…" : res ? "Check again" : "Check courier history"}
          </button>
          <button className={"abtn " + (repOpen ? "" : "danger")} onClick={() => setRepOpen(!repOpen)}>🚩 Report fraud</button>
        </div>
      </div>
      {repMsg && <div className="acard-b" style={{ paddingTop: 10, paddingBottom: 0 }}><div className={"noti " + (repMsg.includes("✓") ? "ok" : "err")}>{repMsg}</div></div>}
      {repOpen && (
        <div className="acard-b" style={{ paddingTop: 12, borderBottom: "1px solid #f0f2f5" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="abtn" value={repType} onChange={(e) => setRepType(e.target.value)} aria-label="Report reason">
              <option>Cancelled order</option>
              <option>Returned parcel</option>
              <option>Fake number / unreachable</option>
              <option>Refused to receive</option>
              <option>Address problem</option>
              <option>Abusive behaviour</option>
            </select>
            <input placeholder="Note (optional)" value={repNote} onChange={(e) => setRepNote(e.target.value)} style={{ flex: 1, minWidth: 160, border: "1px solid #d0d5dd", padding: "9px 12px", borderRadius: 5 }} />
            <button className="abtn danger" onClick={submitReport} disabled={repBusy} aria-busy={repBusy || undefined}>
              {repBusy && <span className="spinner" aria-hidden="true" />} {repBusy ? "Reporting…" : "Confirm report"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Report korle ei number <b>auto-blacklist</b> hobe — bhisher dike ei phone diye notun order place korte parbe na. Vul hole Settings → Fraud Blacklist theke remove korun.
          </div>
        </div>
      )}
      {err && <div className="acard-b" style={{ paddingTop: 12 }}><div className="noti err">{err}</div></div>}
      {!res && !err && (
        <div className="acard-b" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Courier delivery history (Steadfast / Pathao / RedX / Paperfly) + apnar nijer store-er data — shipping er age check korun. Setup: Settings → Courier.
        </div>
      )}
      {res && (
        <div className="acard-b">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <span className="pill DELIVERED">Own store: delivered {res.own.delivered}</span>
            <span className={"pill " + (res.own.cancelled + res.own.returned > 0 ? "CANCELLED" : "DRAFT")}>cancelled {res.own.cancelled} · returned {res.own.returned}</span>
            {res.own.active > 0 && <span className="pill PROCESSING">active {res.own.active}</span>}
            {res.own.successRate != null && <span className={"risk-badge " + tone(res.own.successRate)}>own success {res.own.successRate}%</span>}
          </div>
          {res.stf && (
            res.stf.ok ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: res.provider?.ok ? 14 : 0 }}>
                <span className={"risk-badge " + tone(res.stf.summary?.successRate)}>Steadfast (FREE): {res.stf.summary?.successRate ?? 0}% success</span>
                <span style={{ fontSize: 12, display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <b style={{ color: "#9a7b1e" }}>{res.stf.summary?.total ?? 0} deliveries</b>
                  <b style={{ color: "var(--ok)" }}>{res.stf.summary?.success ?? 0} delivered</b>
                  <b style={{ color: "var(--danger)" }}>{res.stf.summary?.cancel ?? 0} cancelled</b>
                </span>
              </div>
            ) : (
              <div className={"noti " + (res.stf.configured ? "err" : "ok")} style={{ marginBottom: res.provider?.ok ? 14 : 0, fontSize: 12.5 }}>
                {res.stf.configured
                  ? "Steadfast free check fail: " + (res.stf.error || "unknown")
                  : "Steadfast FREE check: Settings → Courier e merchant web email + password din (portal.packzy.com login) — tahole ekhane Steadfast delivery history free dekhajabe."}
              </div>
            )
          )}
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
              <div className="tbl-scroll">
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
              </div>
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

type Nav = { prev: { id: number; code: string; status: string } | null; next: { id: number; code: string; status: string } | null };
export default function OrderDetailClient({ initial, nav }: { initial: Order; nav?: Nav }) {
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const [msgError, setMsgError] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [msg, setMsg] = useState("");
  const [note, setNote] = useState(o.adminNote || "");
  const [edit, setEdit] = useState({ name: o.name, phone: o.phone, address: o.address });
  const [editing, setEditing] = useState(false);

  /* ---- item editing state ---- */
  const [itemsEd, setItemsEd] = useState<any[] | null>(null); // null = view mode
  const [deliveryEd, setDeliveryEd] = useState<string>("");
  const [totalEd, setTotalEd] = useState<string>("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [picker, setPicker] = useState<{ open: boolean; rowIdx: number | null }>({ open: false, rowIdx: null });
  const [pq, setPq] = useState("");
  const [pRes, setPRes] = useState<any[] | null>(null);
  const [pBusy, setPBusy] = useState(false);
  const [pickSel, setPickSel] = useState<{ productId: number; variantId: number | null; qty: string } | null>(null);

  const customerDirty = edit.name !== o.name || edit.phone !== o.phone || edit.address !== o.address;
  const noteDirty = note !== (o.adminNote || "");
  const dirty = itemsEd !== null || customerDirty || noteDirty;
  const closed = ["DELIVERED", "CANCELLED", "RETURNED"].includes(o.status);
  const canSend = !o.courierConsignmentId && ["CONFIRMED", "PROCESSING", "PACKED"].includes(o.status);
  useEffect(() => {
    if (!dirty && !busy) { setO(initial); setEdit({ name: initial.name, phone: initial.phone, address: initial.address }); setNote(initial.adminNote || ""); }
  }, [initial]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const target = new URL(link.href, location.href);
      if (!["http:", "https:"].includes(target.protocol) || (target.pathname === location.pathname && target.search === location.search && target.hash)) return;
      if (!confirm("You have unsaved order changes. Leave without saving?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setKeyboardOpen(!!viewport && window.innerHeight - viewport.height > 150);
    viewport?.addEventListener("resize", update); update();
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  const mutate = async (url: string, options: RequestInit) => {
    if (mutationLock.current) return null;
    mutationLock.current = true; setBusy(true); setMsg(""); setMsgError(false);
    try {
      const response = await afetch(url, options);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || "Could not complete this action. Please retry.");
      return result;
    } catch (error) {
      setMsgError(true); setMsg(error instanceof Error ? error.message : "Network error. Your edits are still here. Please retry.");
      return null;
    } finally { mutationLock.current = false; setBusy(false); }
  };
  const requireSaved = () => {
    if (dirty) { setMsgError(true); setMsg("Save or cancel your edits before changing fulfillment or payment status."); return false; }
    return !mutationLock.current;
  };
  const startItemsEdit = () => {
    if (mutationLock.current) return;
    setItemsEd(o.items.map((i: any) => ({ ...i })));
    setDeliveryEd(String(Math.round(o.deliveryFee || 0)));
    setTotalEd(String(Math.round(o.total || 0)));
    setTotalTouched(false);
  };
  const cancelItemsEdit = () => { setItemsEd(null); setPicker({ open: false, rowIdx: null }); setPickSel(null); setPRes(null); setPq(""); };
  const liveSubtotal = (itemsEd ?? o.items).reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const computedTotal = Math.max(0, liveSubtotal - (o.discount || 0) + (Number(deliveryEd) || 0));
  const shownTotal = totalTouched ? (Number(totalEd) || 0) : computedTotal;

  const openPicker = (rowIdx: number | null) => {
    setPicker({ open: true, rowIdx });
    setPq(""); setPRes(null); setPickSel(null);
    setTimeout(() => { const el = document.getElementById("ordpick-q"); el?.focus(); }, 50);
  };
  const searchPicker = async () => {
    setPBusy(true);
    try {
      const r = await afetch("/api/admin/products" + (pq.trim() ? "?q=" + encodeURIComponent(pq.trim()) : ""));
      const j = await r.json();
      setPRes((j.products || []).slice(0, 12));
    } catch { setPRes([]); }
    setPBusy(false);
  };
  const applyPickRow = (prod: any, v: any, qtyStr: string) => {
    const row = {
      productId: prod.id, variantId: v?.id ?? null,
      title: prod.title, variant: v ? [v.size, v.color].filter(Boolean).join(" · ") : null,
      image: prod.images?.[0]?.url || null, price: v?.price != null ? Number(v.price) : Number(prod.price),
      qty: Math.max(1, Number(qtyStr) || 1),
    };
    if (picker.rowIdx != null) {
      // replace that row's product (drop its id → server removes old + adds new)
      setItemsEd((cur) => (cur || []).map((x, i) => (i === picker.rowIdx ? { ...row } : x)));
    } else {
      setItemsEd((cur) => [...(cur || []), { ...row }]);
    }
    setPicker({ open: false, rowIdx: null }); setPickSel(null); setPRes(null); setPq("");
  };
  const applyPickFor = (prod: any, v: any, qtyStr: string) => applyPickRow(prod, v, qtyStr);
  const saveItems = async () => {
    if (!itemsEd || itemsEd.length === 0) { setMsg("Order e at least ekta item thakte hobe"); return; }
    const body: any = {
      items: itemsEd.map((i) => ({ id: i.id, productId: i.productId, variantId: i.variantId ?? null, price: Number(i.price) || 0, qty: Number(i.qty) || 1 })),
      deliveryFee: Number(deliveryEd) || 0,
      total: shownTotal,
    };
    const result = await mutate("/api/admin/orders/" + o.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!result) return false;
    setO((current: any) => ({ ...current, ...result.order }));
    setItemsEd(null); setMsg("Items and totals saved."); router.refresh();
    return true;
  };

  const copy = async (label: string, text: string) => {
    const ok = await copyText(text);
    setMsgError(!ok); setMsg(ok ? `${label} copied.` : "Copy failed");
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
    if (mutationLock.current) return false;
    if ((body.status || body.paymentStatus) && (!requireSaved() || !confirm(`Change ${body.status ? "order status" : "payment status"} to ${body.status || body.paymentStatus}? Delivery/return changes can update inventory.`))) return false;
    const result = await mutate("/api/admin/orders/" + o.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!result) return false;
    setO((current: any) => ({ ...current, ...result.order }));
    if (body.adminNote !== undefined) setNote(body.adminNote);
    if (body.name !== undefined || body.phone !== undefined || body.address !== undefined) setEdit({ name: result.order?.name ?? body.name ?? o.name, phone: result.order?.phone ?? body.phone ?? o.phone, address: result.order?.address ?? body.address ?? o.address });
    setMsg(noteMsg || "Changes saved."); router.refresh();
    return true;
  };
  const saveCustomer = async () => { if (await put(edit, "Customer details saved.")) setEditing(false); };
  const saveAll = async () => {
    if (itemsEd && !(await saveItems())) return;
    if (customerDirty && !(await put(edit, "Customer details saved."))) return;
    if (noteDirty && !(await put({ adminNote: note }, "Note saved."))) return;
    setEditing(false);
  };
  const sendCourier = async () => {
    if (!requireSaved() || !canSend || !confirm("Send this order to Steadfast courier? This creates a consignment.")) return;
    const result = await mutate(`/api/admin/orders/${o.id}/courier`, { method: "POST" });
    if (!result) return;
    if (!result.consignment?.consignment_id) { setMsgError(true); setMsg("Incomplete courier response. Refresh the order before retrying."); return; }
    setO((current: any) => ({ ...current, courierName: "Steadfast", courierConsignmentId: String(result.consignment.consignment_id), courierStatus: result.consignment.delivery_status || "in_review" }));
    setMsg("Order sent to Steadfast."); router.refresh();
  };
  const quickBlock = async (type: string, value: string) => {
    if (!value || mutationLock.current || !confirm(`Blacklist ${type}: ${value}?`)) return;
    const result = await mutate("/api/admin/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, value, note: "manual: from order " + o.code }) });
    if (result) setMsg(`${type} blacklisted.`);
  };
  const trackCourier = async () => {
    if (!requireSaved()) return;
    const result = await mutate(`/api/admin/orders/${o.id}/courier`, {});
    if (!result) return;
    // This manual check can update order status/inventory server-side: reload its actual state.
    const latest = await mutate(`/api/admin/orders/${o.id}`, {});
    if (latest?.order) setO((current: any) => ({ ...current, ...latest.order }));
    if (latest) setMsg("Courier status refreshed.");
    router.refresh();
  };

  const money = (n: number) => "BDT " + Math.round(n).toLocaleString("en-IN");

  return (
    <section className={"order-detail" + (keyboardOpen ? " is-keyboard-open" : "")} aria-label="Order details">
      <div className="admin-top order-detail-heading">
        <div>
          <h1>{o.code}</h1>
          <div className="who">Placed <FmtDate iso={o.createdAt} /> · Updated <FmtDate iso={o.updatedAt} /></div>
        </div>
        <details className="order-detail-documents"><summary>Documents and order navigation</summary>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={downloadOrder}>⭳ Download</button>
          <ThermalLink orderId={o.id} token={(() => { try { return new URLSearchParams(location.search).get("t") || localStorage.getItem("sz_admin_token") || ""; } catch { return ""; } })()} />
          {nav?.prev && <Link className="abtn" href={withToken("/admin/orders/" + nav.prev.id)} title={"Newer: " + nav.prev.code + " (" + nav.prev.status + ")"}>← {nav.prev.code}</Link>}
          {nav?.next && <Link className="abtn" href={withToken("/admin/orders/" + nav.next.id)} title={"Older: " + nav.next.code + " (" + nav.next.status + ")"}>{nav.next.code} →</Link>}
          <Link className="abtn" href={withToken("/admin/orders?tab=PENDING")}>← Back to Pending Orders</Link>
          <Link className="abtn" href={withToken("/admin/orders/" + o.id + "/invoice")} target="_blank">🖨 Invoice</Link>
          {!o.courierConsignmentId
            ? <button className="abtn primary" onClick={sendCourier} disabled={busy || dirty || !canSend} title={canSend ? "Book with Steadfast" : "Confirm the order before booking; closed or shipped orders cannot be sent"}>🚚 Send to Steadfast</button>
            : <button className="abtn" onClick={trackCourier} disabled={busy || dirty}>🔄 Refresh courier status</button>}
        </div>
        </details>
      </div>
      {msg && <div className={"noti order-detail-notice " + (msgError ? "err" : "ok")} role={msgError ? "alert" : "status"}>{msg}<button type="button" aria-label="Dismiss notification" onClick={() => setMsg("")}>x</button></div>}
      <section className="order-detail-overview" aria-label="Customer and delivery summary">
        <div><span className={"pill " + o.status}>{o.status.replace(/_/g, " ")}</span><h2>{o.name}</h2><a href={telLink(o.phone)}>{o.phone}</a><p>{o.address}</p><small>{o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}</small></div>
        <div className="order-detail-overview-total"><small>Order total / {o.paymentMethod}</small><strong>{money(o.total)}</strong><span className={"pill " + o.paymentStatus}>{o.paymentStatus}</span></div>
        <div className="order-detail-contact">
          <a className="abtn" href={telLink(o.phone)}>Call</a>
          <a className="abtn" href={waLink(o.phone) + "?text=" + encodeURIComponent(orderWhatsAppMessage(o))} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp</a>
          <button className="abtn" onClick={() => copy("Phone", o.phone)}>Copy phone</button>
          <button className="abtn" onClick={() => copy("Address", o.address)}>Copy address</button>
          <a className="abtn" href="#order-customer">Edit customer</a>
        </div>
      </section>
      {o.riskLevel !== "LOW" && (
        <div className="noti err">⚠ Risk level: <b>{o.riskLevel}</b>{o.riskFlags ? " — " + o.riskFlags : ""} — review before shipping.</div>
      )}
      <details className="order-detail-secondary"><summary>Courier history and fraud tools</summary><FraudCheck orderId={o.id} phone={o.phone} /></details>

      <div className="adm-cols order-detail-columns" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start"  }}>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h">
              <h3>Items</h3>
              {!itemsEd
                ? <button className="abtn sm" onClick={startItemsEdit} disabled={busy}>✏️ Edit items</button>
                : <div style={{ display: "flex", gap: 8 }}>
                    <button className="abtn sm primary" onClick={saveItems} disabled={busy} aria-busy={busy || undefined}>{busy && <span className="spinner" aria-hidden="true" />}Save items</button>
                    <button className="abtn sm" onClick={cancelItemsEdit} disabled={busy}>Cancel</button>
                  </div>}
            </div>

            {!itemsEd ? (
              <>
                <div className="tbl-scroll">
                <table className="tbl order-detail-items-table">
                  <thead><tr><th>Product</th><th>Variant</th><th>Price</th><th>Qty</th><th>Total</th></tr></thead>
                  <tbody>
                    {o.items.map((i: any) => (
                      <tr key={i.id}>
                        <td data-label="Product">{i.image && <img src={i.image} alt="" style={{ display: "inline", marginRight: 10, verticalAlign: "middle" }} />}{i.title}{i.preorder ? <span className="po-tag">Pre-order{i.preorderDate ? " · " + new Date(i.preorderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span> : null}</td>
                        <td data-label="Variant">{i.variant || "—"}</td>
                        <td data-label="Price">{money(i.price)}</td><td data-label="Qty">{i.qty}</td><td data-label="Total"><b>{money(i.price * i.qty)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div className="acard-b" style={{ borderTop: "1px solid #e4e7ec" }}>
                  <div className="sum-row"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
                  {o.discount > 0 && <div className="sum-row"><span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span><span>−{money(o.discount)}</span></div>}
                  <div className="sum-row"><span>Delivery ({o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span><span>{money(o.deliveryFee)}</span></div>
                  <div className="sum-row total"><span>Total {o.paymentMethod === "COD" ? "(COD)" : ""}</span><span>{money(o.total)}</span></div>
                </div>
              </>
            ) : (
              <div className="acard-b">
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  Item add / remove / qty-price change korun. Product change korle ager product er stock ferot hobe, notun product er stock kata hobe. Save items na chaple kichu save hobe na.
                </div>
                <div className="tbl-scroll">
                <table className="tbl order-detail-items-table">
                  <thead><tr><th>Product</th><th>Variant</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead>
                  <tbody>
                    {itemsEd.map((i: any, idx: number) => (
                      <tr key={i.id ?? "new-" + idx}>
                        <td data-label="Product">
                          {i.image && <img src={i.image} alt="" style={{ display: "inline", marginRight: 8, verticalAlign: "middle", width: 30, height: 38, objectFit: "cover", borderRadius: 3 }} />}
                          <span style={{ verticalAlign: "middle" }}>{i.title}</span>
                        </td>
                        <td data-label="Variant" style={{ fontSize: 12.5 }}>{i.variant || "—"}</td>
                        <td data-label="Price"><input aria-label={"Price for item " + (idx + 1)} inputMode="decimal" type="number" min={0} value={i.price} onChange={(e) => setItemsEd((cur) => (cur || []).map((x, k) => (k === idx ? { ...x, price: e.target.value } : x)))} style={{ width: 82, padding: "6px 8px" }} /></td>
                        <td data-label="Qty"><input aria-label={"Quantity for item " + (idx + 1)} inputMode="numeric" type="number" min={1} value={i.qty} onChange={(e) => setItemsEd((cur) => (cur || []).map((x, k) => (k === idx ? { ...x, qty: e.target.value } : x)))} style={{ width: 60, padding: "6px 8px" }} /></td>
                        <td data-label="Total"><b>{money((Number(i.price) || 0) * (Number(i.qty) || 0))}</b></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="abtn sm" title="Change product" onClick={() => openPicker(idx)}>↻</button>{" "}
                          <button className="abtn sm danger" title="Remove item" onClick={() => setItemsEd((cur) => (cur || []).filter((_, k) => k !== idx))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="abtn" onClick={() => openPicker(null)}>+ Add product</button>
                </div>
                <div className="sum-row" style={{ marginTop: 14 }}><span>Subtotal</span><span>{money(liveSubtotal)}</span></div>
                {o.discount > 0 && <div className="sum-row"><span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span><span>−{money(o.discount)}</span></div>}
                <div className="sum-row">
                  <span>Delivery ({o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span>
                  <input type="number" min={0} value={deliveryEd} onChange={(e) => setDeliveryEd(e.target.value)} style={{ width: 90, padding: "6px 8px", textAlign: "right" }} />
                </div>
                <div className="sum-row total">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    Grand Total {o.paymentMethod === "COD" ? "(COD)" : ""}
                    {totalTouched && <button className="linklike" onClick={() => { setTotalTouched(false); setTotalEd(String(Math.round(computedTotal))); }}>auto</button>}
                  </span>
                  <input type="number" min={0} value={totalTouched ? totalEd : String(Math.round(computedTotal))}
                    onChange={(e) => { setTotalTouched(true); setTotalEd(e.target.value); }}
                    style={{ width: 110, padding: "7px 9px", textAlign: "right", fontWeight: 700 }} />
                </div>
                {totalTouched && Number(totalEd) !== computedTotal && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>⚠ Manual total — auto hishebe {money(computedTotal)} hoto</div>
                )}
              </div>
            )}
          </div>

          <div className="acard" id="order-customer">
            <div className="acard-h"><h3>Customer</h3>{!editing && <button className="abtn sm" onClick={() => setEditing(true)} disabled={busy}>Edit</button>}{editing && <button className="abtn sm" onClick={() => { setEdit({ name: o.name, phone: o.phone, address: o.address }); setEditing(false); }} disabled={busy}>Cancel</button>}{editing && <button className="abtn sm primary" onClick={saveCustomer} disabled={busy}>Save</button>}</div>
            <div className="acard-b">
              {editing ? (
                <div className="form-grid">
                  <div className="af"><label>Name</label><input aria-label="Customer name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                  <div className="af"><label>Phone</label><input aria-label="Customer phone" inputMode="tel" autoComplete="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                  <div className="af full"><label>Address</label><textarea aria-label="Customer address" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} style={{ minHeight: 70 }} /></div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>{o.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {o.phone}
                    {o.email ? <span>{o.email}</span> : null}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>{o.address}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                    Source: <b>{o.source || "Direct"}</b>
                    {o.attribution && (o.attribution.utm_source || o.attribution.fbclid) ? <> · UTM: {o.attribution.utm_source || "—"} / {o.attribution.utm_medium || "—"} {o.attribution.utm_campaign ? "· " + o.attribution.utm_campaign : ""} {o.attribution.fbclid ? "· fbclid ✓" : ""}</> : null}
                    {o.ip ? <> · IP: {o.ip}</> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <a className="abtn sm" style={{ fontWeight: 600 }} href={telLink(o.phone)}>📞 Call</a>
                    <button className="abtn sm" disabled={busy} onClick={() => copy("Phone", o.phone)}>📋 Copy</button>
                    <a className="abtn sm" style={{ color: "var(--ok)", borderColor: "#c4dfd0", fontWeight: 600 }}
                      href={waLink(o.phone) + "?text=" + encodeURIComponent(orderWhatsAppMessage(o))}
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
                <select aria-label="Order status" value={o.status} onChange={(e) => put({ status: e.target.value }, "Status → " + e.target.value)} disabled={busy}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              {!o.courierConsignmentId && (
                <button className="abtn primary sm" style={{ marginBottom: 12 }} onClick={sendCourier} disabled={busy || dirty || !canSend} title={canSend ? "Book with Steadfast" : "Confirm the order before booking; closed or shipped orders cannot be sent"}>🚚 Send to Steadfast</button>
              )}
              <div className="af" style={{ marginBottom: 12 }}>
                <label>Payment Status</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select aria-label="Payment status" value={o.paymentStatus} onChange={(e) => put({ paymentStatus: e.target.value }, "Payment → " + e.target.value)} disabled={busy} style={{ flex: 1, minWidth: 130 }}>
                    <option>PENDING</option><option>PARTIAL</option><option>PAID</option><option>FAILED</option><option>REFUNDED</option>
                  </select>
                  {o.paymentStatus !== "PENDING" && (
                    <button className="abtn sm" disabled={busy} onClick={() => put({ paymentStatus: "PENDING" }, "Payment → PENDING")}>↩ Back to Pending</button>
                  )}
                </div>
                {(o as any).paymentTrxId && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>TrxID: <b style={{ color: "var(--ad-text)" }}>{(o as any).paymentTrxId}</b> <span style={{ fontSize: 11 }}>(verify, then mark PAID)</span></div>
                )}
                {(o as any).paymentSenderNumber && (
                  <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--muted)" }}>Paid from: <b style={{ color: "var(--ad-text)" }}>{(o as any).paymentSenderNumber}</b> <span style={{ fontSize: 11 }}>(match against the app statement)</span></div>
                )}
              </div>
              <div className="af">
                <label>Admin Note</label>
                <textarea aria-label="Admin note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal notes…" style={{ minHeight: 70 }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <button className="abtn sm" onClick={() => put({ adminNote: note }, "Note saved ✓")} disabled={busy}>Save note</button>
                  <span style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }} title="Steadfast consignment">
                    {o.courierConsignmentId
                      ? <>🚚 <b>{o.courierConsignmentId}</b> <span className="pill SHIPPED">{o.courierStatus || "in review"}</span></>
                      : <>🚚 not sent</>}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <PaymentsCard orderId={o.id} total={o.total} paymentStatus={o.paymentStatus} canMutate={requireSaved} onBusyChange={(value) => { mutationLock.current = value; setBusy(value); }} onSaved={(paymentStatus) => setO((current: any) => ({ ...current, paymentStatus }))} />
        </div>
      </div>

      {/* ---- product picker overlay (item editing) ---- */}
      {picker.open && (
        <div className="modal-bg" onClick={() => setPicker({ open: false, rowIdx: null })}>
          <div className="modal" style={{ width: "min(560px, 94vw)", maxHeight: "82vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPicker({ open: false, rowIdx: null })} aria-label="Close">×</button>
            <h3 style={{ fontFamily: "var(--font-head)", marginBottom: 4 }}>{picker.rowIdx != null ? "Change product" : "Add product"}</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
              {picker.rowIdx != null ? "Ei row er product replace hobe (ager product er stock ferot hobe)" : "Order e notun product add hobe (stock kata hobe)"}
            </div>
            <form style={{ display: "flex", gap: 8, marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); searchPicker(); }}>
              <input id="ordpick-q" placeholder="Product khunje din (title / SKU)…" value={pq} onChange={(e) => setPq(e.target.value)} style={{ flex: 1, padding: "9px 12px", border: "1px solid #d0d5dd", borderRadius: 5 }} autoCapitalize="none" />
              <button className="abtn primary" type="submit" disabled={pBusy} aria-busy={pBusy || undefined}>{pBusy ? "…" : "Search"}</button>
            </form>
            {pRes === null && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Search chapun — sob active product dekhajabe.</div>}
            {pRes !== null && pRes.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Kichu pay nai — onno keyword try korun.</div>}
            {pRes !== null && pRes.map((prod) => {
              const vs = (prod.variants || []).filter((v: any) => v.stock > 0);
              const sel = pickSel?.productId === prod.id ? pickSel : null;
              const chosen = sel ? (prod.variants || []).find((x: any) => x.id === sel.variantId) || vs[0] || null : null;
              return (
                <div key={prod.id} style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {prod.images?.[0] && <img src={prod.images[0].url} alt="" style={{ width: 38, height: 48, objectFit: "cover", borderRadius: 4 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13.5 }}>{prod.title}</b>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>৳{Number(prod.price).toLocaleString("en-IN")} · stock {prod.stock} · {vs.length} variant in stock</div>
                    </div>
                    {(!sel && vs.length === 0) ? (
                      <button className="abtn sm primary" onClick={() => { setPickSel({ productId: prod.id, variantId: null, qty: "1" }); applyPickFor(prod, null, "1"); }}>Select + Add</button>
                    ) : (
                      <button className={"abtn sm" + (sel ? " primary" : "")} onClick={() => setPickSel({ productId: prod.id, variantId: vs[0]?.id ?? null, qty: "1" })}>{sel ? "Selected ✓" : "Select"}</button>
                    )}
                  </div>
                  {sel && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid #f0f2f5", paddingTop: 10 }}>
                      {vs.length > 0 && (
                        <select value={sel.variantId ?? ""} onChange={(e) => setPickSel({ ...sel, variantId: Number(e.target.value) || null })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5, flex: 1, minWidth: 150 }}>
                          {vs.map((v: any) => (
                            <option key={v.id} value={v.id}>{[v.size, v.color].filter(Boolean).join(" · ") || "Default"} — ৳{Number(v.price ?? prod.price).toLocaleString("en-IN")} ({v.stock} pc)</option>
                          ))}
                        </select>
                      )}
                      <input type="number" min={1} value={sel.qty} onChange={(e) => setPickSel({ ...sel, qty: e.target.value })} style={{ width: 64, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} aria-label="Quantity" />
                      <button className="abtn primary" onClick={() => applyPickRow(prod, chosen, sel.qty)}>{picker.rowIdx != null ? "Replace" : "Add to order"}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="order-detail-mobile-bar" role="region" aria-label="Quick order actions">
        <div><b>{dirty ? "Unsaved changes" : o.code}</b><small>{dirty ? "Your edits stay here if saving fails" : o.status.replace(/_/g, " ")}</small></div>
        {dirty ? <button className="abtn primary" disabled={busy} onClick={saveAll}>{busy ? "Saving..." : "Save changes"}</button>
          : o.status === "PENDING" ? <button className="abtn primary" disabled={busy} onClick={() => put({ status: "CONFIRMED" })}>{busy ? "Saving..." : "Confirm order"}</button>
          : canSend ? <button className="abtn primary" disabled={busy} onClick={sendCourier}>{busy ? "Sending..." : "Send courier"}</button>
          : o.courierConsignmentId && !closed ? <button className="abtn" disabled={busy} onClick={trackCourier}>{busy ? "Checking..." : "Check courier"}</button>
          : <a className="abtn" href="#order-customer">Customer details</a>}
      </div>
    </section>
  );
}

/* ---- Payments: what the customer has actually paid -------------------------------
   Rows live in the Payment table; the order total never gets hand-edited to "look paid".
   COD is the normal case here, so the balance shown is what the rider has to collect. */
const PAY_METHODS = [["bkash", "bKash"], ["nagad", "Nagad"], ["rocket", "Rocket"], ["bank", "Bank"], ["cash", "Cash"], ["other", "Other"]];
const PAY_KINDS = [["ADVANCE", "Advance"], ["DUE", "Collected at delivery"], ["REFUND", "Refund"]];

function PaymentsCard({ orderId, total, paymentStatus, canMutate, onBusyChange, onSaved }: { orderId: number; total: number; paymentStatus: string; canMutate: () => boolean; onBusyChange: (value: boolean) => void; onSaved: (status: string) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [form, setForm] = useState({ amount: "", method: "bkash", kind: "ADVANCE", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [loadError, setLoadError] = useState("");
  const paymentLock = useRef(false);
  const load = async () => {
    setLoadError("");
    try {
      const response = await afetch(`/api/admin/orders/${orderId}/payments`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load payment history.");
      setRows(data.rows || []); setSum(data.summary || null);
    } catch { setLoadError("Could not load payments. Retry before recording another payment."); }
  };
  useEffect(() => { load(); }, [orderId, total]);
  const money = (n: number) => "BDT " + Number(n || 0).toLocaleString("en-IN");
  const changePayment = async (method: string, id?: number) => {
    if (paymentLock.current || !canMutate()) return;
    if (method === "DELETE" && !confirm("Remove this payment entry? The paid amount and remaining balance will change.")) return;
    paymentLock.current = true; setBusy(true); onBusyChange(true); setMsg(null);
    try {
      const response = await afetch(`/api/admin/orders/${orderId}/payments${id ? "?paymentId=" + id : ""}`, {
        method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save payment.");
      if (result.paymentStatus) onSaved(result.paymentStatus);
      setMsg({ text: method === "DELETE" ? "Payment entry removed." : "Payment saved. Updated balance: " + money(result.summary?.balance), ok: true });
      if (method === "POST") setForm({ amount: "", method: form.method, kind: form.kind, note: "" });
      await load(); router.refresh();
    } catch (error) { setMsg({ text: error instanceof Error ? error.message : "Network error. Check payment history before retrying.", ok: false }); }
    finally { paymentLock.current = false; setBusy(false); onBusyChange(false); }
  };
  const add = async (event: React.FormEvent) => { event.preventDefault(); await changePayment("POST"); };
  const remove = (id: number) => changePayment("DELETE", id);

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div className="acard-h">
        <h3>Payments</h3>
        {sum && !(paymentStatus === "PAID" && !rows?.length) && (
          <span style={{ fontSize: 12.5 }}>
            <b style={{ color: sum.balance <= 0.5 ? "var(--ok)" : "var(--ad-red, #b42318)" }}>
              {sum.balance > 0.5 ? money(sum.balance) + " to collect" : sum.balance < -0.5 ? money(-sum.balance) + " overpaid" : "fully paid"}
            </b>
            <span style={{ color: "var(--muted)" }}> · paid {money(sum.net)} of {money(total)}</span>
          </span>
        )}
      </div>
      <div className="acard-b" style={{ fontSize: 13 }}>
        {loadError ? <div role="alert" className="noti err">{loadError}<button type="button" className="abtn" onClick={load}>Retry payments</button></div> : rows === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>{paymentStatus === "PAID" ? "Marked paid. No payment ledger entries are available for this order." : "No payment entries recorded. Review the payment status before collecting " + money(total) + "."}</div>
        ) : (
          <div className="tbl-scroll">
          <table className="tbl" style={{ marginBottom: 12 }}>
            <thead><tr><th>When</th><th>Kind</th><th>Method</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{r.kind}</td>
                  <td>{r.method}{r.note ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.note}</div> : null}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.kind === "REFUND" ? "var(--ad-red, #b42318)" : undefined }}>{r.kind === "REFUND" ? "−" : ""}{money(r.amount)}</td>
                  <td><button className="abtn sm" disabled={busy} onClick={() => remove(r.id)} title="Remove entry">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        <form onSubmit={add} style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input aria-label="Payment amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" min="1" step="0.01" placeholder="Amount ৳" required style={{ width: 120, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
            <select aria-label="Payment method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }}>
              {PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select aria-label="Payment kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }}>
              {PAY_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {sum && sum.balance > 0.5 && (
              <button type="button" className="abtn sm" onClick={() => setForm({ ...form, amount: String(Math.round(sum.balance)) })} title="Fill the remaining balance">Full {money(sum.balance)}</button>
            )}
          </div>
          <input aria-label="Payment note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note — bKash TrxID, rider name…" style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
          <button className="abtn primary" type="submit" disabled={busy || !!loadError || !form.amount} style={{ justifySelf: "start" }}>{busy ? "…" : "Add payment"}</button>
          {msg && <div className={"noti " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
        </form>
      </div>
    </div>
  );
}
