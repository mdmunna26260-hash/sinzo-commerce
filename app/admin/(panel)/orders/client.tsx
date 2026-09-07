"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type O = {
  id: number; code: string; name: string; phone: string; area: string; total: number;
  status: string; paymentStatus: string; paymentMethod: string; riskLevel: string;
  channel?: string | null; source?: string | null; courierName?: string | null; courierConsignmentId?: string | null;
  courierStatus?: string | null; createdAt: string; items: { title: string; qty: number; variant?: string | null }[];
};
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];

export default function OrdersClient({ initial }: { initial: O[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => initial.filter((o) =>
    (!status || o.status === status) &&
    (!payment || o.paymentStatus === payment) &&
    (!q || [o.code, o.name, o.phone, o.courierConsignmentId || ""].join(" ").toLowerCase().includes(q.toLowerCase()))
  ), [initial, q, status, payment]);

  const openOrder = (id: number) => router.push(withToken("/admin/orders/" + id));

  const copyPhone = async (e: React.MouseEvent, phone: string) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await copyText(phone);
    setBusy(false);
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
    if (!sel.size) return;
    if (action === "delete" && !confirm(`Delete ${sel.size} order(s)? This cannot be undone.`)) return;
    setBusy(true);
    await afetch("/api/admin/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), action, value }) });
    setSel(new Set()); setBusy(false); router.refresh();
  };
  const exportCsv = () => { window.location.href = withToken("/api/admin/export?type=orders"); };

  return (
    <>
      <div className="admin-top">
        <h1>Orders <span style={{ fontSize: 14, color: "var(--muted)" }}>({list.length})</span></h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={exportCsv}>⭳ Export CSV</button>
          {sel.size > 0 && <>
            <select className="abtn" defaultValue="" onChange={(e) => e.target.value && bulk("status", e.target.value)}>
              <option value="">Set status ({sel.size})…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="abtn danger" onClick={() => bulk("delete")}>Delete</button>
          </>}
        </div>
      </div>
      <div className="stat-strip">
        <input className="asearch" placeholder="Search code / phone / name / consignment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="abtn" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="abtn" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          <option value="PENDING">Unpaid</option><option value="PAID">Paid</option>
        </select>
      </div>
      <div className="acard">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(Array.from(list, (o) => o.id)))} /></th>
                <th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Courier</th><th>Risk</th><th>Source</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={12} style={{ color: "var(--muted)", padding: 30 }}>No orders match.</td></tr>}
              {list.map((o) => (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openOrder(o.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td><Link href={withToken("/admin/orders/" + o.id)} onClick={(e) => e.stopPropagation()}><b>{o.code}</b></Link>{o.channel && o.channel !== "vps" && <span title="Order onugroho onno website theke (Vercel)" style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", color: "#8a6d3b", background: "#f5ecd9", borderRadius: 99, padding: "2px 7px", verticalAlign: "middle" }}>{o.channel.toUpperCase()}</span>}</td>
                  <td>{o.name}<br />
                    <span style={{ color: "var(--muted)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {o.phone}
                      <button className="abtn sm" style={{ padding: "0 5px", fontSize: 11 }} title="Copy phone" onClick={(e) => copyPhone(e, o.phone)}>📋</button>
                      <span>· {o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside"}</span>
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{o.items.map((i) => <div key={i.title}>{i.title}{i.variant ? ` (${i.variant})` : ""} ×{i.qty}</div>)}</td>
                  <td><b>৳{Math.round(o.total).toLocaleString("en-IN")}</b></td>
                  <td><span className={"pill " + o.paymentStatus}>{o.paymentMethod === "COD" ? "COD" : "ONLINE"} · {o.paymentStatus}</span></td>
                  <td><span className={"pill " + o.status}>{o.status}</span></td>
                  <td style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>{o.courierName ? <>{o.courierName}<br /><span style={{ color: "var(--muted)" }}>{o.courierStatus || o.courierConsignmentId}</span></> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                  <td style={{ fontSize: 12 }}>{o.source || "Direct"}</td>
                  <td style={{ fontSize: 12 }}><FmtDate iso={o.createdAt} /></td>
                  <td><Link className="abtn sm" href={withToken("/admin/orders/" + o.id)}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {busy && <div className="toast">Working…</div>}
    </>
  );
}
