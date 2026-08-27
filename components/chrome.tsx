"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart, trackEvent } from "./store";

export type HeaderCfg = { storeName: string; announcement?: string; categories: { name: string; slug: string }[] };

export function Announcement({ text }: { text?: string }) {
  if (!text) return null;
  return <div className="announce">{text}</div>;
}

export function Header({ storeName, categories }: { storeName: string; categories: { name: string; slug: string }[] }) {
  const { count } = useCart();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<any[] | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => { setOpen(false); setSugg(null); }, [path]);

  const onQ = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    if (!v.trim()) { setSugg(null); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(v));
        const j = await r.json();
        setSugg(j.products || []);
      } catch {}
    }, 220);
  };
  const submitQ = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { setSugg(null); router.push("/products?q=" + encodeURIComponent(q.trim())); }
  };

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <button className="burger icon-btn" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <Link href="/" className="logo">{storeName}</Link>
          <nav className="nav">
            <Link href="/products" className={path === "/products" ? "active" : ""}>Shop All</Link>
            {categories.slice(0, 4).map((c) => (
              <Link key={c.slug} href={"/products?category=" + c.slug} className={path === "/products" ? "" : ""}>{c.name}</Link>
            ))}
            <Link href="/track">Track Order</Link>
          </nav>
          <div className="header-actions">
            <button className="icon-btn" aria-label="Search" onClick={() => { setSearchOpen(true); setSugg(null); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <Link href="/account" className="icon-btn" aria-label="Account">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </Link>
            <Link href="/wishlist" className="icon-btn" aria-label="Wishlist">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            </Link>
            <Link href="/cart" className="icon-btn" aria-label="Cart">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>
          </div>
        </div>
        <nav className={"mobile-nav" + (open ? " open" : "")}>
          <Link href="/products">Shop All</Link>
          {categories.slice(0, 6).map((c) => <Link key={c.slug} href={"/products?category=" + c.slug}>{c.name}</Link>)}
          <Link href="/track">Track Order</Link>
          <Link href="/wishlist">Wishlist</Link>
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
  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (r.ok) { setMsg("Thank you — you're on the list."); setEmail(""); trackEvent("Lead", { content_name: "newsletter" }); }
      else setMsg("Please enter a valid email.");
    } catch { setMsg("Something went wrong."); }
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
              <Link key={c.slug} href={"/products?category=" + c.slug}>{c.name}</Link>
            ))}
            <Link href="/products">All Products</Link>
          </div>
          <div>
            <h4>Help</h4>
            <Link href="/track">Track Order</Link>
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
        <div className="container section" style={{ padding: "56px 24px" }}>
          <h2>Join the list</h2>
          <p>Early access to drops, private sales, and 10% off your first order.</p>
          <form onSubmit={subscribe}>
            <input type="email" required placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button type="submit">Subscribe</button>
          </form>
          {msg && <div className="form-note">{msg}</div>}
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
