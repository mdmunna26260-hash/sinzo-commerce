"use client";
import { FmtDate } from "@/components/dates";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PushOptIn from "@/components/push-optin";
import { isValidBDPhone } from "@/lib/phone";

const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

type SavedAddr = { id: number; label: string; name: string; phone: string; address: string; area: string; isDefault: boolean };
const EMPTY_ADDR = { label: "Home", name: "", phone: "", address: "", area: "INSIDE_DHAKA", isDefault: false };

export default function AccountClient({ customer, orders, token, addresses: initialAddresses }: { customer: any; orders: any[]; token: string; addresses: SavedAddr[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"orders" | "addresses" | "profile">("orders");
  const tempPhone = !/^01[3-9]\d{8}$/.test(customer.phone || ""); // Google-login accounts start with a temp id
  const [profile, setProfile] = useState({ name: customer.name || "", email: customer.email || "", phone: tempPhone ? "" : customer.phone, address: customer.address || "", area: customer.area || "INSIDE_DHAKA", currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- address book ----
  const [addrs, setAddrs] = useState<SavedAddr[]>(initialAddresses);
  const [addrForm, setAddrForm] = useState<any | null>(null); // null = list view; {} = adding
  const [editId, setEditId] = useState<number | null>(null);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrErr, setAddrErr] = useState<any>({});

  const addrHeaders = () => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  };
  const openAdd = () => { setEditId(null); setAddrForm({ ...EMPTY_ADDR }); setAddrErr({}); };
  const openEdit = (a: SavedAddr) => { setEditId(a.id); setAddrForm({ label: a.label, name: a.name, phone: a.phone, address: a.address, area: a.area, isDefault: a.isDefault }); setAddrErr({}); };
  const saveAddress = async () => {
    if (!addrForm || addrBusy) return;
    const e: any = {};
    if (!addrForm.name.trim() || addrForm.name.trim().length < 3) e.name = "Full name din";
    if (!isValidBDPhone(addrForm.phone || "")) e.phone = "Valid BD mobile din (01XXXXXXXXX)";
    if (!addrForm.address.trim() || addrForm.address.trim().length < 10) e.address = "Full address din (house, road, area)";
    setAddrErr(e);
    if (Object.keys(e).length) return;
    setAddrBusy(true);
    const body = JSON.stringify({ ...addrForm, phone: addrForm.phone.trim() });
    const r = editId
      ? await call("/api/addresses/" + editId, { method: "PUT", headers: addrHeaders(), body })
      : await call("/api/addresses", { method: "POST", headers: addrHeaders(), body });
    const j = await r.json().catch(() => ({}));
    setAddrBusy(false);
    if (r.ok) {
      setMsg(editId ? "Address updated ✓" : "Address added ✓");
      setAddrForm(null); setEditId(null);
      const list = await call("/api/addresses", { headers: addrHeaders() });
      if (list.ok) { const lj = await list.json(); setAddrs(lj.addresses || []); }
      setTimeout(() => setMsg(""), 3000);
    } else {
      setAddrErr(j.errors || {}); setMsg(j.error || "Failed");
      setTimeout(() => setMsg(""), 3000);
    }
  };
  const delAddress = async (a: SavedAddr) => {
    if (!confirm("Ei address delete hobe. Confirm?")) return;
    setAddrBusy(true);
    const r = await call("/api/addresses/" + a.id, { method: "DELETE", headers: addrHeaders() });
    setAddrBusy(false);
    if (r.ok) { setAddrs((xs) => xs.filter((x) => x.id !== a.id)); setMsg("Deleted"); setTimeout(() => setMsg(""), 2500); }
  };
  const setDefault = async (a: SavedAddr) => {
    setAddrBusy(true);
    const r = await call("/api/addresses/" + a.id, { method: "PUT", headers: addrHeaders(), body: JSON.stringify({ action: "setDefault" }) });
    setAddrBusy(false);
    if (r.ok) setAddrs((xs) => xs.map((x) => ({ ...x, isDefault: x.id === a.id })));
  };

  const call = (url: string, opts: RequestInit = {}) => {
    const headers = new Headers(opts.headers || {});
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", "Bearer " + token);
    return fetch(url, { ...opts, headers });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    const body: any = { name: profile.name, email: profile.email, address: profile.address, area: profile.area };
    if (tempPhone && profile.phone.trim()) body.phone = profile.phone.trim();
    if (profile.newPassword) { body.currentPassword = profile.currentPassword; body.newPassword = profile.newPassword; }
    const r = await call("/api/account/update", { method: "POST", body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok && j.token) { document.cookie = `sz_customer=${j.token}; path=/; max-age=2592000; SameSite=Lax`; router.refresh(); }
    setMsg(r.ok ? "Saved ✓" : j.error || "Failed");
    if (r.ok) setProfile({ ...profile, currentPassword: "", newPassword: "" });
    setBusy(false);
    setTimeout(() => setMsg(""), 3000);
  };
  const logout = async () => { await call("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); };

  const totalSpent = orders.filter((o) => !["CANCELLED"].includes(o.status)).reduce((a, o) => a + o.total, 0);

  return (
    <div className="container" style={{ padding: "38px 24px 100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div className="eyebrow">My account</div>
          <h1 style={{ fontSize: "clamp(26px,3.2vw,38px)", margin: "6px 0" }}>Hi, {customer.name || "there"} 👋</h1>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>{customer.phone}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={logout}>Sign out</button>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "26px 0 22px" }}>
        <button className={"chip" + (tab === "orders" ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => setTab("orders")}>My Orders ({orders.length})</button>
        <button className={"chip" + (tab === "addresses" ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => setTab("addresses")}>Addresses ({addrs.length})</button>
        <button className={"chip" + (tab === "profile" ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => setTab("profile")}>Profile &amp; Password</button>
      </div>

      {tab === "orders" && (
        <>
          <div className="stat-strip" style={{ maxWidth: 520 }}>
            <div className="kpi"><div className="k-label">Total Orders</div><div className="k-val">{orders.length}</div></div>
            <div className="kpi"><div className="k-label">Total Spent</div><div className="k-val">{money(totalSpent)}</div></div>
          </div>
          {orders.length === 0 && (
            <div className="empty"><h3>No orders yet</h3><p>Order history ekhane dekhabe.</p><br /><Link className="btn" href="/products">Start Shopping</Link></div>
          )}
          <div style={{ display: "grid", gap: 14 }}>
            {orders.map((o) => (
              <div className="acard" key={o.code} style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <b>{o.code}</b> <span className={"pill " + o.status} style={{ marginLeft: 8 }}>{o.status}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{<FmtDate iso={o.createdAt} mode="date" />} · {o.paymentMethod}</div>
                </div>
                <div style={{ display: "flex", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
                  {o.items.slice(0, 4).map((i, k) => (
                    <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                      {i.image && <img src={i.image} alt="" style={{ width: 34, height: 42, objectFit: "cover", borderRadius: 3 }} />}
                      <span>{i.title.slice(0, 24)} ×{i.qty}</span>
                    </div>
                  ))}
                  {o.items.length > 4 && <span style={{ fontSize: 12, color: "var(--muted)" }}>+{o.items.length - 4} more</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 12, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{money(o.total)} <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>· {o.itemCount} item(s)</span></span>
                  <Link className="btn btn-outline btn-sm" href={"/track?code=" + o.code + "&phone=" + customer.phone}>Track</Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "addresses" && (
        <div style={{ maxWidth: 640 }}>
          {msg && <div className={"noti " + (msg.includes("✓") || msg === "Deleted" ? "ok" : "err")}>{msg}</div>}
          {addrForm === null ? (
            <>
              {addrs.length === 0 ? (
                <div className="empty" style={{ padding: "48px 20px" }}>
                  <h3>No saved addresses</h3>
                  <p>Checkout er somoy address save korlei ekhane chole ashbe.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {addrs.map((a) => (
                    <div className="acard acct-addr" key={a.id} style={{ padding: 16 }}>
                      <div className="acct-addr-top">
                        <b>{a.label}</b>
                        {a.isDefault ? <span className="tag">DEFAULT</span> : (
                          <button type="button" className="linklike" onClick={() => setDefault(a)} disabled={addrBusy}>Set default</button>
                        )}
                      </div>
                      <div style={{ fontSize: 13.5, margin: "6px 0 2px" }}>{a.name} · {a.phone}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>{a.address}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{a.area === "OUTSIDE_DHAKA" ? "Outside Dhaka" : "Inside Dhaka"}</div>
                      <div className="acct-addr-actions">
                        <button type="button" className="abtn sm" onClick={() => openEdit(a)}>Edit</button>
                        <button type="button" className="abtn sm danger" onClick={() => delAddress(a)} disabled={addrBusy}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-outline" style={{ marginTop: 14 }} onClick={openAdd} type="button">+ Add New Address</button>
            </>
          ) : (
            <form className="acard" style={{ padding: 26 }}
              onSubmit={(e) => { e.preventDefault(); saveAddress(); }}>
              <h3 style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editId ? "Edit Address" : "Add New Address"}</h3>
              <div className="field">
                <label>Label</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Home", "Office", "Other"].map((l) => (
                    <button type="button" key={l} className={"chip" + (addrForm.label === l ? " active" : "")} style={{ cursor: "pointer" }}
                      onClick={() => setAddrForm({ ...addrForm, label: l })}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Full Name *</label>
                  <input value={addrForm.name} onChange={(e) => setAddrForm({ ...addrForm, name: e.target.value })} placeholder="e.g. Rahim Ahmed" />
                  {addrErr.name && <div className="err">{addrErr.name}</div>}
                </div>
                <div className="field">
                  <label>Mobile Number *</label>
                  <input value={addrForm.phone} onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="numeric" />
                  {addrErr.phone && <div className="err">{addrErr.phone}</div>}
                </div>
              </div>
              <div className="field">
                <label>Full Address *</label>
                <textarea value={addrForm.address} onChange={(e) => setAddrForm({ ...addrForm, address: e.target.value })} placeholder="House / Road / Area, Thana, City" rows={2} style={{ minHeight: 0, resize: "vertical" }} />
                {addrErr.address && <div className="err">{addrErr.address}</div>}
              </div>
              <div className="field">
                <label>Delivery Zone</label>
                <select value={addrForm.area} onChange={(e) => setAddrForm({ ...addrForm, area: e.target.value })}>
                  <option value="INSIDE_DHAKA">Inside Dhaka</option>
                  <option value="OUTSIDE_DHAKA">Outside Dhaka</option>
                </select>
              </div>
              {!editId && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={addrForm.isDefault} onChange={(e) => setAddrForm({ ...addrForm, isDefault: e.target.checked })} style={{ width: 15, height: 15 }} />
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Set as default address</span>
                </label>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" type="submit" disabled={addrBusy} aria-busy={addrBusy || undefined}>
                  {addrBusy && <span className="spinner" aria-hidden="true" />}<span style={addrBusy ? { marginLeft: 8 } : undefined}>{addrBusy ? "Saving…" : "Save Address"}</span>
                </button>
                <button className="btn btn-outline" type="button" onClick={() => { setAddrForm(null); setEditId(null); setAddrErr({}); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "profile" && (
        <form className="acard" style={{ padding: 26, maxWidth: 560 }} onSubmit={save}>
          {msg && <div className={"noti " + (msg.includes("✓") ? "ok" : "err")}>{msg}</div>}
          <PushOptIn phone={customer.phone} variant="row" />
          {tempPhone && (
            <div className="noti ok" style={{ fontSize: 13 }}>
              Google diye login korchen — order korun, ba niche apnar <b>mobile number</b> add korun jate order track korte paren.
            </div>
          )}
          <div className="field"><label>Full Name</label><input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></div>
          {tempPhone ? (
            <div className="field"><label>Mobile Number (order track korar jonno)</label><input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="numeric" /></div>
          ) : (
            <div className="field"><label>Mobile (login id — fixed)</label><input value={customer.phone} disabled style={{ background: "#f6f4f1" }} /></div>
          )}
          <div className="field"><label>Email</label><input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
          <div className="field"><label>Default Address</label><textarea value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} style={{ minHeight: 70 }} /></div>
          <div className="field"><label>Default Zone</label>
            <select value={profile.area} onChange={(e) => setProfile({ ...profile, area: e.target.value })}>
              <option value="INSIDE_DHAKA">Inside Dhaka</option>
              <option value="OUTSIDE_DHAKA">Outside Dhaka</option>
            </select>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", margin: "14px 0", paddingTop: 14 }}>
            <div className="field-row">
              <div className="field"><label>Current password (change korle)</label><input type="password" value={profile.currentPassword} onChange={(e) => setProfile({ ...profile, currentPassword: e.target.value })} /></div>
              <div className="field"><label>New password</label><input type="password" value={profile.newPassword} onChange={(e) => setProfile({ ...profile, newPassword: e.target.value })} /></div>
            </div>
          </div>
          <button className="btn" disabled={busy} type="submit">{busy ? "Saving…" : "Save Changes"}</button>
        </form>
      )}
    </div>
  );
}
