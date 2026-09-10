"use client";
import { FmtDate } from "@/components/dates";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PushOptIn from "@/components/push-optin";
import { setTrackingPhone } from "@/components/store";
import { AppearancePicker } from "@/components/theme-toggle";

const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

export default function AccountClient({ customer, orders, token }: { customer: any; orders: any[]; token: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"orders" | "profile">("orders");
  // cache phone once → Meta advanced matching on every event
  if (customer?.phone) setTrackingPhone(customer.phone);
  const tempPhone = !/^01[3-9]\d{8}$/.test(customer.phone || ""); // Google-login accounts start with a temp id
  const [profile, setProfile] = useState({ name: customer.name || "", email: customer.email || "", phone: tempPhone ? "" : customer.phone, address: customer.address || "", area: customer.area || "INSIDE_DHAKA", currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);


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

      {tab === "profile" && (
        <div className="acard" style={{ padding: 26, maxWidth: 560, marginTop: 14 }}>
          <h3 style={{ marginBottom: 6 }}>Appearance</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
            Site er theme — "System" chol phone er dark/light setting follow korbe.
          </p>
          <AppearancePicker />
        </div>
      )}
    </div>
  );
}
