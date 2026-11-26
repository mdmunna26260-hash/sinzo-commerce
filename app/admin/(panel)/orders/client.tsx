"use client";
import { escapeHtml } from "@/lib/escape-html";
import { orderWhatsAppMessage } from "@/lib/order-whatsapp";
import { telLink, waLink } from "@/lib/phone";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type O = {
  id: number; code: string; name: string; phone: string; address: string; area: string; total: number;
  adminNote?: string | null; status: string; paymentStatus: string; paymentMethod: string; riskLevel: string;
  channel?: string | null; source?: string | null; courierName?: string | null; courierConsignmentId?: string | null;
  courierStatus?: string | null; createdAt: string; items: { title: string; qty: number; image?: string | null; variant?: string | null; preorder?: boolean }[];
};
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];
/* Labels only — the matching itself lives in lib/admin-workflow.ts (orderTabWhere) and runs
   in the query, so a tab reaches every order instead of just the loaded page. */
const TABS: [string, string][] = [["ALL", "All"], ["PENDING", "Pending"], ["CONFIRMED", "Confirmed"], ["READY", "Ready to send"], ["ACTIVE", "Active"], ["ON_HOLD", "On Hold"], ["PREORDER", "Pre-order"], ["DELIVERED", "Delivered"], ["CLOSED", "Cancelled/Returned"]];
/* The ?queue= value behind each tab, for links that must preserve the linked-queue view. */
const TAB_QUEUE: Record<string, string> = { READY: "ready", PENDING: "pending", ON_HOLD: "hold" };

type Props = {
  initial: O[];
  initialTab?: string;
  initialQueue?: string;
  page: number;
  pages: number;
  total: number;
  counts: Record<string, number>;
  pageSize: number;
};

export default function OrdersClient({ initial, initialTab = "ALL", initialQueue = "", page, pages, total, counts, pageSize }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  /* The tab is owned by the URL (the server filters on it), so this mirrors the prop rather
     than being editable — there is no local-only tab state left to drift out of sync. */
  const tab = TABS.some(([key]) => key === initialTab) ? initialTab : "ALL";
  const [payment, setPayment] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [zone, setZone] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rowLock = useRef(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Record<number, Partial<O>>>({});
  const [noteEdit, setNoteEdit] = useState<{ id: number; draft: string; original: string } | null>(null);
  const [noteError, setNoteError] = useState("");
  const noteDirty = !!noteEdit && noteEdit.draft !== noteEdit.original;
  useEffect(() => {
    if (!noteDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || !link.getAttribute("href")?.startsWith("/")) return;
      if (!confirm("Leave with an unsaved internal note?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [noteDirty]);
  const discardNote = () => {
    if (rowLock.current || (noteDirty && !confirm("Discard this unsaved internal note?"))) return false;
    setNoteEdit(null); setNoteError(""); return true;
  };
  const editNote = (order: O) => {
    if (busy || rowLock.current || !discardNote()) return;
    setNoteEdit({ id: order.id, draft: order.adminNote || "", original: order.adminNote || "" });
  };
  const saveNote = async (order: O) => {
    if (!noteEdit || noteEdit.id !== order.id || busy || rowLock.current) return;
    const draft = noteEdit.draft;
    rowLock.current = true; setRowBusy(order.id); setNoteError("");
    try {
      const response = await afetch("/api/admin/orders/" + order.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminNote: draft }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save note. Your text is kept.");
      const saved = data.order?.adminNote ?? draft;
      setRowOverrides(current => ({ ...current, [order.id]: { ...current[order.id], adminNote: saved } }));
      setNoteEdit(null); setActionNotice({ text: order.code + ": internal note saved", error: false }); router.refresh();
    } catch (error) { setNoteError(error instanceof Error ? error.message : "Could not confirm save. Your text is kept for retry."); }
    finally { rowLock.current = false; setRowBusy(null); }
  };
  const [actionNotice, setActionNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => { setRowOverrides({}); }, [initial]);
  const orders = useMemo(() => initial.map((order) => ({ ...order, ...rowOverrides[order.id] })), [initial, rowOverrides]);
  const filterCount = Number(!!payment) + Number(!!dateFilter) + Number(!!zone);
  const resetFilters = () => { setPayment(""); setDateFilter(""); setZone(""); };

  /* Tab filtering happens in the query (lib/admin-workflow.ts orderTabWhere), so this only
     narrows the CURRENT PAGE by the secondary filters. That is deliberate: search, payment,
     date and zone stay instant, and the summary line says how many rows on this page match. */
  const list = useMemo(() => orders.filter((o) => {
    if (payment && o.paymentStatus !== payment) return false;
    if (zone && o.area !== zone) return false;
    if (q.trim() && ![o.code, o.name, o.phone, o.courierConsignmentId || "", ...o.items.map((item) => item.title + " " + (item.variant || ""))].join(" ").toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (dateFilter) {
      const d = new Date(o.createdAt);
      const now = new Date();
      if (dateFilter === "today") {
        if (d.toDateString() !== now.toDateString()) return false;
      } else if (dateFilter === "yesterday") {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        if (d.toDateString() !== y.toDateString()) return false;
      } else if (dateFilter === "week") {
        if ((now.getTime() - d.getTime()) > 7 * 86400000) return false;
      } else if (dateFilter === "month") {
        if ((now.getTime() - d.getTime()) > 30 * 86400000) return false;
      }
    }
    return true;
  }), [orders, q, payment, dateFilter, zone]);

  const hrefFor = (nextTab: string, nextPage = 1) => {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    // keep a linked-queue view linked; never introduce ?queue= into the plain list
    if (initialQueue && TAB_QUEUE[nextTab]) params.set("queue", TAB_QUEUE[nextTab]);
    if (nextPage > 1) params.set("page", String(nextPage));
    return withToken("/admin/orders?" + params.toString());
  };

  const openOrder = (id: number) => router.push(withToken("/admin/orders/" + id));

  const copyPhone = async (e: React.MouseEvent, phone: string) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await copyText(phone);
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = ok ? "📋 " + phone + " copied" : "Copy failed";
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  };

  const toggle = (id: number) => {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSel(s);
  };
  const allSel = list.length > 0 && list.every((o) => sel.has(o.id));

  const bulk = async (action: string, value?: string) => {
    if (!sel.size || busy || rowLock.current) return;
    if (action === "courier" && !confirm(`Send ${sel.size} order(s) to Steadfast?`)) return;
    if (action === "delete" && !confirm(`Delete ${sel.size} order(s)? Delivered/courier-active orders must be returned or cancelled first.`)) return;
    rowLock.current = true;
    setBusy(true);
    try {
      const response = await afetch("/api/admin/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), action, value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failures = (result.results || []).filter((item: any) => !item.ok).map((item: any) => `#${item.id}: ${item.error}`).join("\n");
        alert(failures || result.error || "The bulk action could not be completed.");
      } else if (action === "courier") {
        alert(`Sent: ${result.sent || 0} / Failed: ${result.failed || 0}${result.failed ? "\n" + (result.results || []).filter((item: any) => !item.ok).map((item: any) => item.code + ": " + item.error).join("\n") : ""}`);
      }
      setSel(new Set());
      router.refresh();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      rowLock.current = false;
      setBusy(false);
    }
  };
  const runCardAction = async (order: O, status?: string) => {
    if (busy || rowLock.current || status === order.status) return;
    if (!status && (order.courierConsignmentId || !["CONFIRMED", "PROCESSING", "PACKED"].includes(order.status))) return;
    const prompt = status
      ? `Change ${order.code} to ${status.replace(/_/g, " ")}? Delivery/return changes may update inventory.`
      : `Send ${order.code} to Steadfast? This creates a courier consignment.`;
    if (!confirm(prompt)) return;
    rowLock.current = true;
    setRowBusy(order.id); setActionNotice(null);
    try {
      const response = await afetch(`/api/admin/orders/${order.id}${status ? "" : "/courier"}`, {
        method: status ? "PUT" : "POST",
        ...(status ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save this order. Please retry.");
      if (status) {
        setRowOverrides((current) => ({ ...current, [order.id]: { ...current[order.id], status: data.order?.status || status, paymentStatus: data.order?.paymentStatus || order.paymentStatus } }));
      } else {
        if (!data.consignment?.consignment_id) throw new Error("Courier response is incomplete. Refresh the order before retrying.");
        setRowOverrides((current) => ({ ...current, [order.id]: {
          ...current[order.id], courierName: "Steadfast", courierConsignmentId: String(data.consignment.consignment_id),
          courierStatus: data.consignment.delivery_status || "in_review", status: order.status === "ON_HOLD" ? "SHIPPED" : order.status,
        } }));
      }
      setActionNotice({ text: status ? `${order.code}: status updated` : `${order.code}: sent to Steadfast`, error: false });
      router.refresh();
    } catch (error) {
      setActionNotice({ text: `${order.code}: ${error instanceof Error ? error.message : "Network error. Please retry."}`, error: true });
    } finally { rowLock.current = false; setRowBusy(null); }
  };
  const exportCsv = () => { window.location.href = withToken("/api/admin/export?type=orders"); };

  return (
    <section className="orders-page" aria-label="Orders management">
      <div className="admin-top orders-heading">
        <h1>Orders <span className="orders-count">{total}</span></h1>
        <div className="admin-actions">
          <button className="abtn orders-export" onClick={exportCsv}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
            Export CSV
          </button>
        </div>
      </div>
      <p className="orders-queue-context">
        {total === 0
          ? <>No orders in this tab yet.</>
          : <>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} orders
            {tab !== "ALL" && <> in this tab</>}
            {pages > 1 && <> · page {page} of {pages}</>}
            {initialQueue && <> · {initialQueue} queue</>}
            . Payment, date and zone filters apply to this page only — narrow the tab, or use the sidebar search, to reach an older order.</>}
        {initialQueue && <> <Link href={withToken("/admin/orders")}>View all orders</Link></>}
      </p>
      {sel.size > 0 && <fieldset className="orders-bulk" disabled={busy || rowBusy !== null}>
            <legend>{sel.size} selected</legend>
            <select className="abtn" defaultValue="" onChange={(e) => e.target.value && bulk("status", e.target.value)}>
              <option value="">Set status ({sel.size})…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="abtn" onClick={() => bulk("courier")}>Send to Steadfast</button>
            <button className="abtn" onClick={() => {
              const w = window.open("", "_blank");
              if (!w) return;
              const labels = Array.from(sel).map((id) => {
                const o = orders.find((x) => x.id === id);
                if (!o) return "";
                const consignment = o.courierConsignmentId || "—";
                const items = (o.items || []).map((i: any) => `${escapeHtml(i.title)}${i.variant ? " (" + escapeHtml(i.variant) + ")" : ""}${i.preorder ? " [PRE-ORDER]" : ""} x ${escapeHtml(i.qty)}`).join("<br>");
                return `<div style="page-break-after:always;padding:20px 16px;border-bottom:2px solid #333;font-family:Arial,sans-serif">
                  <div style="text-align:center;margin-bottom:12px">
                    <span style="font-family:Charm,'Brush Script MT',cursive;font-size:18px;font-weight:700;letter-spacing:.15em">SINZO</span>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Consignment ID</div>
                    <div style="font-size:15px;font-weight:700">${escapeHtml(consignment)}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Steadfast ID</div>
                    <div style="font-size:13px;font-weight:600">${consignment !== "—" ? "SF-" + escapeHtml(consignment) : "—"}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Customer Phone</div>
                    <div style="font-size:14px;font-weight:600">${escapeHtml(o.phone)}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Items</div>
                    <div style="font-size:12px;line-height:1.6">${items}</div>
                  </div>
                </div>`;
              }).join("");
              w.document.write("<html><head><style>@font-face{font-family:Charm;font-weight:700;src:url(" + location.origin + "/fonts/charm-700.woff2) format('woff2')}@media print { .no-print { display:none } } body { margin: 0; background: #fff }</style></head><body>" + labels + "</body></html>");
              w.document.close();
              // wait for the Charm wordmark font so the printed label isn't in the fallback face
              const go = () => setTimeout(() => w.print(), 200);
              try { w.document.fonts.load("700 18px Charm").then(go, go); } catch { go(); }
            }}>🖨 Print labels</button>
            <button className="abtn danger" onClick={() => bulk("delete")}>Delete</button>
            <button className="abtn" onClick={() => setSel(new Set())}>Clear selection</button>
      </fieldset>}
      <div className="orders-filters">
        <div className="orders-search-row">
          <div className="orders-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            <input type="search" placeholder="Search order, name, phone, CID..." aria-label="Search orders by code, name, phone or consignment" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="orders-clear-search" aria-label="Clear order search" onClick={() => setQ("")}>x</button>}
          </div>
          <button className={"abtn orders-filter-toggle" + (filterCount ? " has-filters" : "")} aria-expanded={filtersOpen} aria-controls="orders-extra-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
            Filters{filterCount > 0 && <span>{filterCount}</span>}
          </button>
        </div>
        <div className="orders-status-tabs" role="group" aria-label="Filter orders by status">
          {TABS.map(([key, label]) => {
            // counts come from the server for the whole tab, not from the rows on this page
            const n = counts[key] || 0;
            const active = tab === key;
            return <button key={key} className={"orders-status-tab" + (active ? " is-active" : "")} aria-pressed={active} onClick={() => {
              if (key === tab) return;
              // every tab is a real page now, so always navigate (and go back to page 1)
              router.push(hrefFor(key, 1));
            }}>{label} <span style={{ opacity: 0.65 }}>({n})</span></button>;
          })}
        </div>
        <div id="orders-extra-filters" className="orders-extra-filters" hidden={!filtersOpen}>
        <label>Payment<select aria-label="Filter by payment status" className="abtn" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          <option value="PENDING">Unpaid</option><option value="PAID">Paid</option>
        </select></label>
        <label>Date range<select aria-label="Filter by date range" className="abtn" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="">All dates</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select></label>
        <label>Delivery zone<select aria-label="Filter by delivery zone" className="abtn" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">All zones</option><option value="INSIDE_DHAKA">Inside Dhaka</option><option value="OUTSIDE_DHAKA">Outside Dhaka</option>
        </select></label>
        {filterCount > 0 && <button className="abtn" onClick={resetFilters}>Reset filters</button>}
        </div>
      </div>
      {actionNotice && <div className={"orders-action-notice" + (actionNotice.error ? " is-error" : "")} role={actionNotice.error ? "alert" : "status"}>
        <span>{actionNotice.text}</span><button type="button" aria-label="Dismiss order notification" onClick={() => setActionNotice(null)}>x</button>
      </div>}
      <div className="orders-list-summary">
        <label><input type="checkbox" aria-label="Select all matching orders" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(list.map((o) => o.id)))} /> Select all</label>
        <span role="status">{list.length} {list.length === 1 ? "order" : "orders"}{sel.size > 0 ? ` / ${sel.size} selected` : ""}</span>
      </div>
      <div className="orders-mobile-list" aria-label="Order cards">
        {list.length === 0 && <div className="orders-empty"><b>No orders found</b><p>{total === 0 ? "There are no orders in this tab yet." : "None of the orders on this page match the current filters."}</p><button className="abtn" onClick={() => { resetFilters(); setQ(""); router.push(withToken("/admin/orders")); }}>Reset all filters</button></div>}
        {list.map((o) => (
          <article className={"order-mobile-card" + (sel.has(o.id) ? " is-selected" : "")} key={o.id} aria-label={"Order " + o.code}>
            <div className="order-mobile-head">
              <input type="checkbox" aria-label={"Select " + o.code} checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
              <Link href={withToken("/admin/orders/" + o.id)} className="order-mobile-code">{o.code}</Link>
              {o.courierConsignmentId && <span className="order-mobile-consignment" title={(o.courierName || "Courier") + " consignment ID"}>CID {o.courierConsignmentId}</span>}
              <span className={"pill " + o.status}><i aria-hidden="true" />{o.status.replace(/_/g, " ")}</span>
            </div>
            <Link href={withToken("/admin/orders/" + o.id)} className="order-mobile-content" aria-label={"View " + o.code + " for " + o.name}>
              <div className="order-mobile-customer"><strong>{o.name}</strong><b>{"BDT " + Math.round(o.total).toLocaleString("en-IN")}</b></div>
              <div className="order-mobile-area">{o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}</div>
              <ul className="order-mobile-items">{o.items.map((item, index) => (
                <li key={index}>
                  <span className="order-item-thumb" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z" /></svg>
                    {item.image && <img src={/^\/api\/media\/[^/]+$/.test(item.image) ? item.image + "/w80" : item.image} alt="" width={42} height={48} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />}
                  </span>
                  <span className="order-item-info"><span className="order-item-title">{item.title}</span>{item.variant && <small>{item.variant}</small>}{item.preorder && <span className="po-tag">Pre-order</span>}</span><b>x{item.qty}</b></li>
              ))}</ul>
            </Link>
            <div className="order-mobile-meta">
              <span className={"pill " + o.paymentStatus}>{o.paymentMethod === "COD" ? "COD" : o.paymentMethod} / {o.paymentStatus}</span>
              <span><FmtDate iso={o.createdAt} /></span>
            </div>
            <div className="order-card-note">
              {noteEdit?.id === o.id ? <div className="order-card-note-editor">
                <label htmlFor={"order-note-" + o.id}>Internal note <small>Admin only</small></label>
                <textarea id={"order-note-" + o.id} aria-label={"Internal note for " + o.code} rows={2} maxLength={2000} autoFocus disabled={rowBusy !== null || busy} value={noteEdit.draft} onChange={event => setNoteEdit(current => current ? { ...current, draft: event.target.value } : current)} placeholder="e.g. Call after 5 PM" />
                {noteError && <p role="alert">{noteError}</p>}
                <div><span>{noteEdit.draft.length}/2000</span><button type="button" className="abtn" disabled={rowBusy !== null || busy} onClick={discardNote}>Cancel</button><button type="button" className="abtn primary" disabled={rowBusy !== null || busy || !noteDirty} onClick={() => saveNote(o)}>{rowBusy === o.id ? "Saving..." : "Save note"}</button></div>
              </div> : <button type="button" className="order-card-note-preview" disabled={rowBusy !== null || busy} aria-label={(o.adminNote ? "Edit internal note for " : "Add internal note for ") + o.code} onClick={() => editNote(o)}><span className="order-card-note-label">Note</span><span className={"order-card-note-text" + (!o.adminNote ? " is-empty" : "")}>{o.adminNote || "Add internal note"}</span><span className="order-card-note-edit">{o.adminNote ? "Edit" : "+"}</span></button>}
            </div>
            {o.courierName && <div className="order-mobile-courier"><i aria-hidden="true" />{o.courierName} / {o.courierStatus ? o.courierStatus.replace(/_/g, " ") : "Awaiting update"}</div>}
            <div className="order-mobile-footer">
              <a href={telLink(o.phone)} aria-label={"Call " + o.name}>{o.phone}</a>
              <a className="order-contact order-contact-wa" href={waLink(o.phone) + "?text=" + encodeURIComponent(orderWhatsAppMessage(o))} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={"WhatsApp " + o.name} title="WhatsApp customer">WP</a>
              <a className="order-contact" href={telLink(o.phone)} aria-label={"Call customer for " + o.code}>Call</a>
              <Link className="order-mobile-open" href={withToken("/admin/orders/" + o.id)}>View order <span aria-hidden="true">&rarr;</span></Link>
            </div>
            <div className="order-mobile-actions" aria-busy={rowBusy === o.id}>
              {o.status === "PENDING" ? (
                <button type="button" className="abtn order-confirm" disabled={busy || rowBusy !== null} onClick={() => runCardAction(o, "CONFIRMED")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                  {rowBusy === o.id ? "Saving..." : "Confirm order"}
                </button>
              ) : !["DELIVERED", "CANCELLED", "RETURNED"].includes(o.status) && o.courierConsignmentId ? (
                <Link className="abtn order-parcel" href={withToken("/admin/orders/" + o.id)}>View parcel <span aria-hidden="true">&rarr;</span></Link>
              ) : (
                <button type="button" className="abtn order-send" disabled={busy || rowBusy !== null || !!o.courierConsignmentId || !["CONFIRMED", "PROCESSING", "PACKED"].includes(o.status)} onClick={() => runCardAction(o)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 5h12v12H2zM14 9h4l4 4v4h-8M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4m12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4" /></svg>
                  {rowBusy === o.id ? "Saving..." : ["DELIVERED", "CANCELLED", "RETURNED"].includes(o.status) ? "Order " + o.status.toLowerCase() : o.status === "ON_HOLD" ? "On hold" : o.status === "SHIPPED" ? "Already shipped" : "Send to courier"}
                </button>
              )}
              <label className="order-mini-status"><span>Status</span>
                <select aria-label={"Change status for " + o.code} value={o.status} disabled={busy || rowBusy !== null} onChange={(event) => runCardAction(o, event.target.value)}>
                  {STATUSES.map((status) => <option value={status} key={status}>{status.replace(/_/g, " ")}</option>)}
                </select>
              </label>
            </div>
          </article>
        ))}
      </div>
      <div className="acard orders-desktop-list">
        <div className="tbl-scroll tbl-sticky tbl-sticky-2">
          <table className="tbl">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all matching orders in table" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(Array.from(list, (o) => o.id)))} /></th>
                <th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th className="hide-m">Courier</th><th className="hide-m">Risk</th><th className="hide-m">Source</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={12} style={{ color: "var(--muted)", padding: 30 }}>No orders match.</td></tr>}
              {list.map((o) => (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openOrder(o.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={"Select " + o.code} checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td><Link href={withToken("/admin/orders/" + o.id)} onClick={(e) => e.stopPropagation()}><b>{o.code}</b></Link>{o.channel && o.channel !== "vps" && <span title="Order onugroho onno website theke (Vercel)" style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", color: "#8a6d3b", background: "#f5ecd9", borderRadius: 99, padding: "2px 7px", verticalAlign: "middle" }}>{o.channel.toUpperCase()}</span>}</td>
                  <td>{o.name}<br />
                    <span style={{ color: "var(--muted)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {o.phone}
                      <button className="abtn sm" style={{ padding: "0 5px", fontSize: 11 }} title="Copy phone" onClick={(e) => copyPhone(e, o.phone)}>📋</button>
                      <span>· {o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside"}</span>
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{o.items.map((i, index) => <div key={index}>{i.title}{i.variant ? ` (${i.variant})` : ""} ×{i.qty}{i.preorder ? <span className="po-tag">Pre-order</span> : null}</div>)}</td>
                  <td><b>৳{Math.round(o.total).toLocaleString("en-IN")}</b></td>
                  <td><span className={"pill " + o.paymentStatus}>{o.paymentMethod === "COD" ? "COD" : "ONLINE"} · {o.paymentStatus}</span></td>
                  <td><span className={"pill " + o.status}>{o.status}</span></td>
                  <td className="hide-m" style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>{o.courierName ? <>{o.courierName}<br /><span style={{ color: "var(--muted)" }}>{o.courierStatus || o.courierConsignmentId}</span></> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td className="hide-m"><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                  <td className="hide-m" style={{ fontSize: 12 }}>{o.source || "Direct"}</td>
                  <td style={{ fontSize: 12 }}><FmtDate iso={o.createdAt} /></td>
                  <td><Link className="abtn sm" href={withToken("/admin/orders/" + o.id)}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {pages > 1 && (
        <nav className="orders-pager" aria-label="Order pages">
          <button type="button" className="abtn" disabled={page <= 1} onClick={() => router.push(hrefFor(tab, page - 1))}>&larr; Previous</button>
          <span aria-live="polite">Page {page} of {pages}</span>
          <button type="button" className="abtn" disabled={page >= pages} onClick={() => router.push(hrefFor(tab, page + 1))}>Next &rarr;</button>
        </nav>
      )}
      {busy && <div className="toast">Working…</div>}
    </section>
  );
}
