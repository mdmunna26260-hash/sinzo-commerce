"use client";
import { FmtDate } from "@/components/dates";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { afetch, withToken } from "@/lib/afetch";

const SEG: any = { New: "#eee9e2", Returning: "#e8eef8", VIP: "#f3e4f8", Risky: "#f8e2e0", Blocked: "#f8e2e0" };
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

type C = any;

export default function CustomersClient({ initial }: { initial: C[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<C | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<C[]>(initial);

  const list = useMemo(() => initial.filter((c) => !q || (c.name + c.phone + (c.email || "")).toLowerCase().includes(q.toLowerCase())), [initial, q]);

  const api = async (url: string, method: string, body?: any) => {
    const r = await afetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg("Done ✓"); router.refresh(); } else setMsg(j.error || "Failed");
    setTimeout(() => setMsg(""), 2200);
    return j;
  };
  const toggleBlockPhone = async (c: C) => {
    setBusy(true);
    if (c.phoneBlocked && c.phoneBlacklistId) {
      await afetch("/api/admin/blacklist?id=" + c.phoneBlacklistId, { method: "DELETE" });
    } else {
      await api("/api/admin/blacklist", "POST", { type: "PHONE", value: c.phone, note: "manual: from customers page" });
    }
    setBusy(false);
  };

  const refreshCourier = async (o: any) => {
    setBusy(true);
    const r = await afetch(`/api/admin/orders/${o.id}/courier`);
    const j = await r.json();
    setBusy(false);
    if (r.ok) {
      const next = items.map((c) => c.id === detail?.id ? {
        ...c, history: c.history.map((h: any) => h.id === o.id ? { ...h, courierStatus: j.data?.delivery_status || h.courierStatus } : h),
      } : c);
      setItems(next);
      if (detail) setDetail({ ...detail, history: next.find((c) => c.id === detail.id)?.history || [] });
      setMsg("Courier status: " + (j.data?.delivery_status || "unknown") + " ✓");
    } else setMsg(j.configured === false ? "⚠ Steadfast NOT CONFIGURED" : "Courier error: " + (j.error || ""));
    setTimeout(() => setMsg(""), 3000);
  };

  const courierPill = (s?: string | null) => {
    if (!s) return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
    const cls = /deliver/i.test(s) ? "DELIVERED" : /return/i.test(s) ? "CANCELLED" : /cancel/i.test(s) ? "CANCELLED" : "SHIPPED";
    return <span className={"pill " + cls}>{s}</span>;
  };

  return (
    <>
      <div className="admin-top">
        <h1>Customers <span style={{ fontSize: 14, color: "var(--muted)" }}>({initial.length})</span></h1>
        <button className="abtn" onClick={() => (window.location.href = withToken("/api/admin/export?type=customers"))}>⭳ Export CSV</button>
      </div>
      {msg && <div className="noti ok">{msg}</div>}
      <input className="asearch" style={{ marginBottom: 14 }} placeholder="Search name / phone / email…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="acard">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Total Spent</th><th>Cancelled</th><th>Last Order</th><th>Segment</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name || "—"}</b>{c.email && <><br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{c.email}</span></>}</td>
                  <td>{c.phone}{c.phoneBlocked && <> <span className="pill CANCELLED">BLOCKED</span></>}</td>
                  <td>{c.orders}</td>
                  <td><b>{money(c.spent)}</b></td>
                  <td>{c.cancelled}</td>
                  <td style={{ fontSize: 12.5 }}>{c.lastOrder ? <FmtDate iso={c.lastOrder} mode="date" /> : "—"}</td>
                  <td><span className="risk-badge" style={{ background: SEG[c.segment], color: "#444" }}>{c.segment}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" onClick={() => setDetail(c)}>📋 History</button>{" "}
                    <button className="abtn sm danger" title={c.phoneBlocked ? "Unblock phone" : "Blacklist phone"} disabled={busy} onClick={() => toggleBlockPhone(c)}>
                      {c.phoneBlocked ? "✅" : "🚫"}
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)", padding: 30 }}>No customers found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Customer detail modal: profile + courier history ---------- */}
      {detail && (
        <div className="modal-bg" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            <h3>{detail.name || "Customer"} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>· {detail.phone}</span></h3>
            <div className="stat-strip">
              <div className="kpi" style={{ padding: "10px 14px" }}><div className="k-label">Orders</div><div className="k-val" style={{ fontSize: 18 }}>{detail.orders}</div></div>
              <div className="kpi" style={{ padding: "10px 14px" }}><div className="k-label">Spent</div><div className="k-val" style={{ fontSize: 18 }}>{money(detail.spent)}</div></div>
              <div className="kpi" style={{ padding: "10px 14px" }}><div className="k-label">Cancelled/Returned</div><div className="k-val" style={{ fontSize: 18 }}>{detail.cancelled}</div></div>
              <div className="kpi" style={{ padding: "10px 14px" }}><div className="k-label">Phone</div><div style={{ paddingTop: 8 }}><button className="abtn sm danger" disabled={busy} onClick={() => toggleBlockPhone(detail)}>{detail.phoneBlocked ? "✅ Unblock" : "🚫 Blacklist phone"}</button></div></div>
            </div>
            {detail.address && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>📍 {detail.address}</div>}
            <h4 style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)", margin: "6px 0 10px" }}>Courier &amp; Order History (Steadfast)</h4>
            <div style={{ display: "grid", gap: 8, maxHeight: 380, overflow: "auto" }}>
              {detail.history.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Kono order nai.</div>}
              {detail.history.map((o: any) => (
                <div key={o.id} className="acard" style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                    <div>
                      <b>{o.code}</b> <span className={"pill " + o.status} style={{ marginLeft: 6 }}>{o.status}</span>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                        {<FmtDate iso={o.createdAt} />} · {money(o.total)} · {o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {o.courierConsignmentId ? (
                        <>
                          <div style={{ fontSize: 12 }}><b>{o.courierName || "Steadfast"}</b> · {courierPill(o.courierStatus)}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                            ID: {o.courierConsignmentId}
                            <button className="abtn sm" style={{ padding: "1px 8px" }} disabled={busy} onClick={() => refreshCourier(o)}>🔄</button>
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Courier-e jay nai</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>🔄 = Steadfast theke live status refresh (delivery/return history auto-update)</div>
          </div>
        </div>
      )}
    </>
  );
}
