"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart, trackEvent } from "./store";
import { ThemeIconToggle } from "./theme-toggle";

export type HeaderCfg = { storeName: string; announcement?: string; categories: { name: string; slug: string }[] };

export function Announcement({ text }: { text?: string }) {
  if (!text) return null;
  const item = <span className="announce-item">{text}<i className="announce-dot" aria-hidden>◆</i></span>;
  return (
    <div className="announce" role="marquee">
      <div className="announce-track">
        {item}{item}{item}{item}
      </div>
    </div>
  );
}

/* Admin-only dashboard shortcut on the storefront header.
   Visible only when the visitor has a valid admin session
   (cookie on production, or ?t= / saved token elsewhere).
   Result is cached in sessionStorage (10 min) so the 99% of visitors
   who are NOT admins don't hit /api/admin/whoami on every page load. */
function AdminDashLink() {
  const [state, setState] = useState<{ show: boolean; href: string }>({ show: false, href: "/admin/dashboard" });
  useEffect(() => {
    (async () => {
      try {
        const cached = sessionStorage.getItem("sz_admin_whoami");
        if (cached && Date.now() - JSON.parse(cached).at < 10 * 60 * 1000) {
          if (JSON.parse(cached).ok) setState((s) => ({ ...s, show: true }));
          return;
        }
      } catch {}
      let token = "";
      try { token = new URLSearchParams(location.search).get("t") || ""; } catch {}
      if (!token) { try { token = localStorage.getItem("sz_admin_token") || ""; } catch {} }
      try {
        const headers: HeadersInit = token ? { Authorization: "Bearer " + token } : {};
        const r = await fetch("/api/admin/whoami", { headers });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok) {
            try { sessionStorage.setItem("sz_admin_whoami", JSON.stringify({ ok: true, at: Date.now() })); } catch {}
            setState({ show: true, href: token ? "/admin/dashboard?t=" + encodeURIComponent(token) : "/admin/dashboard" });
            return;
          }
        }
        try { sessionStorage.setItem("sz_admin_whoami", JSON.stringify({ ok: false, at: Date.now() })); } catch {}
      } catch {}
    })();
  }, []);
  if (!state.show) return null;
  return (
    <Link href={state.href} className="icon-btn" title="Admin dashboard" aria-label="Admin dashboard">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
    </Link>
  );
}

export function Header({ storeName, categories }: { storeName: string; categories: { name: string; slug: string }[] }) {
  const { count, ready } = useCart();
  const path = usePathname();
  /* hide header on scroll down, show on scroll up (product page + all pages) */
  const [hid, setHid] = useState(false);
  const lastY = useRef(0);
  const headerRef = useRef<HTMLElement>(null);
  /* cart badge pop when count increases (waits for cart hydration, no pop on page loads) */
  const [pop, setPop] = useState(false);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevCount.current === null) { prevCount.current = count; return; }
    if (count > prevCount.current) {
      prevCount.current = count;
      setPop(true);
      const t = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count, ready]);
  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      headerRef.current?.classList.toggle("scrolled", y > 24);
      if (Math.abs(y - lastY.current) < 8) return; // ignore tiny scrolls
      setHid(y > lastY.current && y > 120);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<any[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => { setOpen(false); setSugg(null); }, [path]);

  /* Auto-close the mobile menu: on scroll, click/tap outside (burger+menu),
     Escape, or resize to desktop width. */
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    let raf: number | undefined;
    const close = () => setOpen(false);
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = undefined; close(); });
    };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || burgerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onResize = () => { if (window.innerWidth >= 900) close(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open]);

  const onQ = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    if (!v.trim()) { setSugg(null); return; }
    setFetching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(v));
        const j = await r.json();
        setSugg(j.products || []);
      } catch {}
      setFetching(false);
    }, 220);
  };
  const submitQ = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { setSugg(null); router.push("/products?q=" + encodeURIComponent(q.trim())); }
  };

  return (
    <>
      <header ref={headerRef} className={"header" + (hid ? " hid" : "")}>
        <div className="container header-inner">
          <button ref={burgerRef} className="burger icon-btn" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <Link prefetch href="/" className="logo">{storeName}</Link>
          <nav className="nav">
            <Link prefetch href="/products" className={path === "/products" ? "active" : ""}>Shop All</Link>
            {categories.slice(0, 4).map((c) => (
              <Link key={c.slug} href={"/products?category=" + c.slug} className={path === "/products" ? "" : ""}>{c.name}</Link>
            ))}
            <Link prefetch href="/track">Track Order</Link>
          </nav>
          <div className="header-actions">
            <AdminDashLink />
            <ThemeIconToggle />
            <button className="icon-btn" aria-label="Search" onClick={() => { setSearchOpen(true); setSugg(null); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <Link prefetch href="/wishlist" className="icon-btn" aria-label="Wishlist">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            </Link>
            {/* cart: desktop only — mobile has the floating tab bar */}
            <Link prefetch href="/cart" className="icon-btn desktop-only" aria-label="Cart">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              {count > 0 && <span className={"cart-badge" + (pop ? " pop" : "")}>{count > 99 ? "99+" : count}</span>}
            </Link>
          </div>
        </div>
        <nav ref={menuRef} className={"mobile-nav" + (open ? " open" : "")}>
          <Link href="/products" onClick={() => setOpen(false)}>Shop All</Link>
          {categories.slice(0, 6).map((c) => <Link prefetch key={c.slug} href={"/products?category=" + c.slug} onClick={() => setOpen(false)}>{c.name}</Link>)}
        </nav>
      </header>

      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-panel" onClick={(e) => e.stopPropagation()}>
            <div className="container">
              <form className="search-form" onSubmit={submitQ}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flex: "none", color: "var(--muted)" }}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input autoFocus placeholder="Search products…" value={q} onChange={(e) => onQ(e.target.value)} aria-label="Search products" autoCapitalize="none" spellCheck={false} />
                <button type="button" className="icon-btn" aria-label="Close search" onClick={() => setSearchOpen(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </form>
              {sugg === null && q.trim().length < 2 && <div className="search-hint" style={{ padding: "16px 2px 0" }}>Popular right now ↓ — likhte shuru korun</div>}
              {fetching && <div className="search-hint" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 2px 0" }}><span className="spinner" aria-hidden="true" /> Searching…</div>}
              {sugg !== null && (
                <>
                  <div className="eyebrow" style={{ margin: "18px 0 8px" }}>{q.trim().length >= 2 ? (sugg.length ? "Products" : "") : "Popular right now"}</div>
                  {q.trim().length >= 2 && sugg.length === 0 && <div className="search-hint" style={{ padding: "6px 2px" }}>“{q}”-er jonno kichu pay nai — banan bhul thakte pare</div>}
                  <div className="search-results">
                    {sugg.slice(0, 6).map((p) => (
                      <Link key={p.id} href={"/products/" + p.slug} onClick={() => { setSearchOpen(false); if (q.trim().length >= 2) trackEvent("Search", { search_string: q }); }}>
                        {p.image && <img src={p.image} alt="" />}
                        <div style={{ flex: 1 }}><div className="st">{p.title}</div></div>
                        {p.price != null && <div className="sp">৳{Number(p.price).toLocaleString("en-IN")}</div>}
                      </Link>
                    ))}
                  </div>
                  {q.trim().length >= 2 && sugg.length > 0 && (
                    <Link className="btn btn-outline search-all" href={"/products?q=" + encodeURIComponent(q.trim())} onClick={() => { setSearchOpen(false); trackEvent("Search", { search_string: q }); }}>
                      View all results →
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Footer({ cfg }: { cfg: any }) {
  const store = cfg?.store || {};
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subscribing) return;
    setSubscribing(true);
    try {
      const r = await fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (r.ok) { setMsg("Thank you — you're on the list."); setEmail(""); trackEvent("Lead", { content_name: "newsletter" }); }
      else setMsg("Please enter a valid email.");
    } catch { setMsg("Something went wrong."); }
    setSubscribing(false);
  };
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="logo" style={{ fontSize: 22 }}>{store.name}</div>
            <p className="about">{store.footerText}</p>
          </div>
          <div>
            <h4>Shop</h4>
            {(cfg?._nav?.categories || []).slice(0, 5).map((c: any) => (
              <Link prefetch key={c.slug} href={"/products?category=" + c.slug}>{c.name}</Link>
            ))}
            <Link prefetch href="/products">All Products</Link>
          </div>
          <div>
            <h4>Help</h4>
            <Link prefetch href="/track">Track Order</Link>
            <Link href="/products">Shipping</Link>
            <Link href="/products">Returns &amp; Exchange</Link>
            <a href={store.whatsapp ? "https://wa.me/" + String(store.whatsapp).replace(/[^0-9]/g, "") : "#"} target="_blank" rel="noreferrer">WhatsApp Support</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href={"mailto:" + store.email}>{store.email}</a>
            <a href={"tel:" + String(store.phone || "").replace(/\s/g, "")}>{store.phone}</a>
            <a href={store.facebook} target="_blank" rel="noreferrer">Facebook</a>
            <a href={store.instagram} target="_blank" rel="noreferrer">Instagram</a>
          </div>
        </div>
      </div>
      <div className="newsletter">
        <div className="container nl-grid">
          <div>
            <div className="eyebrow" style={{ opacity: .75 }}>Newsletter</div>
            <h2>Join the {store.name || "SINZO"} list</h2>
            <p>Early access to drops, private sales, and 10% off your first order.</p>
          </div>
          <div>
            <form onSubmit={subscribe}>
              <input type="email" required placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" disabled={subscribing} />
              <button type="submit" disabled={subscribing} aria-busy={subscribing || undefined}>
                {subscribing ? <span className="spinner" aria-hidden="true" /> : "Subscribe →"}
              </button>
            </form>
            {msg && <div className="form-note">{msg}</div>}
          </div>
        </div>
      </div>
      <div className="container">
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {store.name}. All rights reserved.</span>
          <span>Cash on Delivery across Bangladesh · {store.address}</span>
        </div>
      </div>
    </footer>
  );
}
