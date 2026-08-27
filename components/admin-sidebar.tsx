"use client";
import { FmtDate } from "@/components/dates";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { afetch, withToken } from "@/lib/afetch";

const NAV: { group: string; items: { href: string; label: string; icon: string; badge?: string }[] }[] = [
  { group: "Overview", items: [
    { href: "/admin/dashboard", label: "Dashboard", icon: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zM13 9h8V3h-8v6z" },
  ]},
  { group: "Commerce", items: [
    { href: "/admin/orders", label: "Orders", icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0", badge: "pending" },
    { href: "/admin/products", label: "Products", icon: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
    { href: "/admin/catalog", label: "Categories & Collections", icon: "M4 6h16M4 12h16M4 18h10" },
    { href: "/admin/customers", label: "Customers", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    { href: "/admin/coupons", label: "Coupons", icon: "M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2m-5 0 2 2-2 2h-4" },
  ]},
  { group: "Engagement", items: [
    { href: "/admin/reviews", label: "Reviews", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" },
    { href: "/admin/marketing", label: "Marketing", icon: "M3 11l18-7-7 18-2.5-7.5z" },
  ]},
  { group: "Growth tools", items: [
    { href: "/admin/analytics", label: "Advanced Analytics", icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" },
    { href: "/admin/tracking", label: "Tracking & Pixels", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
    { href: "/admin/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" },
    { href: "/admin/users", label: "Team", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
    { href: "/admin/audit", label: "Audit Log", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
  ]},
];

function decodeToken(t?: string | null): any {
  try {
    const payload = (t || "").split(".")[0];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

export default function Sidebar({ pending, lowStock }: { pending: number; lowStock: number }) {
  const path = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const urlT = sp.get("t") || "";
  let t = urlT;
  if (!t) { try { t = localStorage.getItem("sz_admin_token") || ""; } catch {} }
  const link = (href: string) => (t ? href + "?t=" + encodeURIComponent(t) : href);
  const user = decodeToken(t);
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = async () => {
    try { await afetch("/api/admin/logout", { method: "POST" }); } catch {}
    try { localStorage.removeItem("sz_admin_token"); } catch {}
    document.cookie = "sz_session_fb=; path=/; max-age=0";
    router.push("/admin/login");
  };

  /* ---- notification center (polls every 20s) ---- */
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const loadNotifs = async () => {
    try {
      const r = await afetch("/api/admin/notifications");
      if (r.ok) { const j = await r.json(); setNotifs(j.notifications || []); setUnread(j.unreadCount || 0); }
    } catch {}
  };
  useEffect(() => { loadNotifs(); const iv = setInterval(loadNotifs, 20000); return () => clearInterval(iv); }, []);
  const markAll = async () => { await afetch("/api/admin/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "readAll" }) }); loadNotifs(); };
  const clearAll = async () => { await afetch("/api/admin/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) }); loadNotifs(); };

  return (
    <>
      {/* mobile topbar */}
      <div className="admin-topbar">
        <button aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
        <span className="logo">COMMERCE PANEL</span>
        <Link href="/" target="_blank" aria-label="View website" style={{ display: "flex", padding: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>
        </Link>
      </div>
      {menuOpen && <div className="admin-scrim" onClick={() => setMenuOpen(false)} />}
    <aside className={"admin-side" + (menuOpen ? " open" : "")}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 14px" }}>
        <button className="abtn sm" style={{ background: "transparent", borderColor: "rgba(255,255,255,.15)", color: "#fff", display: "none" }} aria-hidden>×</button>
      </div>
      <Link href={link("/admin/dashboard")} className="logo" onClick={() => setMenuOpen(false)}>{user?.name ? user.name.split(" ")[0].toUpperCase() : "ADMIN"}<span style={{ fontSize: 10, display: "block", color: "#6c7280", letterSpacing: ".2em" }}>COMMERCE PANEL</span></Link>

      <div className="bell-wrap">
        <button className="bell-btn" onClick={() => { setNotifOpen(!notifOpen); loadNotifs(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          Notifications
          {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </div>
      {notifOpen && (
        <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
          <div className="np-h">
            <span>🔔 Notifications {unread > 0 && <span style={{ color: "var(--danger)" }}>({unread} notun)</span>}</span>
            <span style={{ display: "flex", gap: 6 }}>
              {unread > 0 && <button className="abtn sm" onClick={markAll}>Mark all read</button>}
              <button className="abtn sm danger" onClick={clearAll}>Clear</button>
              <button className="abtn sm" onClick={() => setNotifOpen(false)}>✕</button>
            </span>
          </div>
          {notifs.length === 0 && <div className="notif-item" style={{ color: "var(--muted)" }}>Kono notification nai — notun order ashlei ekhane dekhabe.</div>}
          {notifs.map((n) => (
            <div key={n.id} className={"notif-item" + (n.read ? "" : " unread")}>
              <div className="nt">{n.title}</div>
              <div className="nb">{n.body}</div>
              <div className="nd">{n.type} · {<FmtDate iso={n.createdAt} />}</div>
            </div>
          ))}
        </div>
      )}

      {NAV.map((g) => (
        <div key={g.group}>
          <div className="grp">{g.group}</div>
          {g.items.map((it) => {
            const badge = it.badge === "pending" ? pending : it.badge === "stock" ? lowStock : 0;
            return (
              <Link key={it.href} href={link(it.href)} onClick={() => setMenuOpen(false)} className={path.startsWith(it.href) ? "active" : ""}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={it.icon} /></svg>
                <span style={{ flex: 1 }}>{it.label}</span>
                {badge > 0 && <span style={{ background: "#9a7b4f", color: "#fff", fontSize: 10, borderRadius: 99, padding: "1px 7px" }}>{badge}</span>}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="grp">Account</div>
      <div style={{ padding: "6px 22px", fontSize: 12, color: "#6c7280", wordBreak: "break-all" }}>{user?.email || "…"}<br /><span style={{ color: "#9a7b4f" }}>{user?.role || ""}</span></div>
      <Link href="/" target="_blank" style={{ marginTop: 6 }}>↗ View Storefront</Link>
      <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>⎋ Sign out</a>
    </aside>
    </>
  );
}
