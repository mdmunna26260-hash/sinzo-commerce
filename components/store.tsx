"use client";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/* ============ Client-side tracking service (Meta Pixel + GA4 + GTM + server CAPI) ============ */
function getCfg(): any {
  try { return JSON.parse(document.getElementById("sz-cfg")?.textContent || "{}"); } catch { return {}; }
}
function genEventId(): string {
  return "ev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}
/** Generate a purchase event id up-front: browser pixel + server CAPI share it (dedup). */
export function newEventId(): string {
  return genEventId();
}
function getCookie(n: string): string | undefined {
  const m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : undefined;
}
function getFbc(): string | undefined {
  const params = new URLSearchParams(location.search);
  const fbclid = params.get("fbclid");
  if (fbclid && !getCookie("sz_fbc")) {
    const fbc = `fb.1.${Date.now()}.${fbclid}`;
    document.cookie = `sz_fbc=${fbc};path=/;max-age=${60 * 60 * 24 * 90}`;
    return fbc;
  }
  return getCookie("sz_fbc") || undefined;
}
export function captureAttribution(): any {
  try {
    const p = new URLSearchParams(location.search);
    const attr: any = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]) {
      if (p.get(k)) attr[k] = p.get(k);
    }
    if (document.referrer) attr.referrer = document.referrer;
    if (Object.keys(attr).length) {
      sessionStorage.setItem("sz_attr", JSON.stringify(attr));
      return attr;
    }
    return JSON.parse(sessionStorage.getItem("sz_attr") || "{}");
  } catch { return {}; }
}
export function trackEvent(name: string, data?: Record<string, any>, opts?: { eventId?: string }): string {
  const eventId = opts?.eventId || genEventId();
  const cfg = getCfg();
  const pixel = cfg?.integrations?.metaPixelId;
  const ga4 = cfg?.integrations?.ga4Id;
  const value = data?.value;
  const currency = data?.currency || "BDT";
  try {
    // Meta Pixel (browser)
    const w = window as any;
    if (pixel) {
      w.fbq = w.fbq || function (...a: any[]) { (w.fbq.queue = w.fbq.queue || []).push(a); };
      if (!w.fbq.loaded) {
        if (!document.getElementById("meta-pixel")) {
          const s = document.createElement("script"); s.id = "meta-pixel"; s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
          document.head.appendChild(s);
        }
        w.fbq("init", pixel); w.fbq.loaded = true;
      }
      const std = ["PageView", "ViewContent", "Search", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "Lead", "CompleteRegistration"];
      const metaName = std.includes(name) ? name : "Custom" + name.replace(/\s/g, "");
      w.fbq("track", metaName, data || {}, { eventID: eventId });
    }
    // GA4
    if (ga4) {
      w.dataLayer = w.dataLayer || [];
      if (!w.gtag) { w.gtag = function (...a: any[]) { w.dataLayer.push(a); }; }
      if (!document.getElementById("ga4-script")) {
        const s = document.createElement("script"); s.id = "ga4-script"; s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${ga4}`; document.head.appendChild(s);
        w.dataLayer.push(["js", new Date()]);
        w.dataLayer.push(["config", ga4]);
      }
      const gaMap: Record<string, string> = { ViewContent: "view_item", AddToCart: "add_to_cart", InitiateCheckout: "begin_checkout", Purchase: "purchase", Search: "search" };
      w.gtag("event", gaMap[name] || name.toLowerCase(), { currency, value, items: data?.contents, event_id: eventId });
    }
    // GTM dataLayer
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: name, ecommerce: data, event_id: eventId });
  } catch {}
  // Server log + CAPI forward (dedup via same eventId)
  try {
    fetch("/api/track/event", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ name, eventId, url: location.href, data, fbp: getCookie("_fbp"), fbc: getFbc() }),
    }).catch(() => {});
  } catch {}
  return eventId;
}

/* ============ Cart (localStorage, guest-friendly) ============ */
export type CartLine = { key: string; productId: number; variantId?: number; slug: string; title: string; image?: string; price: number; qty: number; size?: string; color?: string; stock: number; sizes?: string[] };
const CART_KEY = "sz_cart_v1";

/* Memory-first cart store: module-level state survives client-side navigation
   (React providers remount per page), localStorage is used as a persistent
   backup when the browser allows it (blocked in some embedded previews). */
let memoryCart: CartLine[] | null = null;
function loadCart(): CartLine[] {
  if (memoryCart) return memoryCart;
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    // corrupted / non-array storage (old schema, manual edit, quota glitch) → safe reset
    memoryCart = Array.isArray(parsed) ? parsed.filter((l) => l && typeof l === "object" && l.productId) : [];
  } catch { memoryCart = []; }
  return memoryCart!;
}
function saveCart(c: CartLine[]) {
  memoryCart = c;
  try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {}
}

type CartCtx = { lines: CartLine[]; count: number; subtotal: number; ready: boolean; add: (l: Omit<CartLine, "key">, qty?: number) => void; setQty: (key: string, qty: number) => void; updateLine: (key: string, patch: Partial<CartLine>) => void; remove: (key: string) => void; clear: () => void; };
const EMPTY_CTX: CartCtx = { lines: [], count: 0, subtotal: 0, ready: false, add: () => {}, setQty: () => {}, updateLine: () => {}, remove: () => {}, clear: () => {} };
const Ctx = createContext<CartCtx>(EMPTY_CTX);
export function useCart() { return useContext(Ctx); }

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => { setLines(loadCart()); setReady(true);
    const h = () => setLines(loadCart());
    window.addEventListener("sz_cart_changed", h); return () => window.removeEventListener("sz_cart_changed", h);
  }, []);
  const commit = useCallback((c: CartLine[]) => { saveCart(c); setLines([...c]); window.dispatchEvent(new Event("sz_cart_changed")); }, []);
  const add: CartCtx["add"] = (l, qty = 1) => {
    const c = [...loadCart()];
    const key = `${l.productId}:${l.variantId || 0}`;
    const ex = c.find((x) => x.key === key);
    const maxStock = l.stock ?? 99;
    if (ex) ex.qty = Math.min(ex.qty + qty, maxStock); else c.push({ ...l, key, qty: Math.min(qty, maxStock) });
    commit(c);
    trackEvent("AddToCart", { value: l.price * qty, currency: "BDT", content_ids: [String(l.productId)], content_type: "product", contents: [{ id: String(l.productId), quantity: qty, item_price: l.price }] });
  };
  const setQty: CartCtx["setQty"] = (key, qty) => { const c = loadCart(); const e = c.find((x) => x.key === key); if (e) e.qty = Math.max(1, Math.min(qty, e.stock || 99)); commit(c); };
  const updateLine: CartCtx["updateLine"] = (key, patch) => {
    const c = loadCart();
    const e = c.find((x) => x.key === key);
    if (!e) return;
    // size change → new identity key
    const newKey = `${e.productId}:${patch.variantId ?? e.variantId ?? 0}`;
    Object.assign(e, patch, patch.variantId != null ? { key: newKey } : {});
    e.qty = Math.max(1, Math.min(e.qty, e.stock || 99));
    commit(c);
  };
  const remove: CartCtx["remove"] = (key) => commit(loadCart().filter((x) => x.key !== key));
  const clear = () => commit([]);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  return <Ctx.Provider value={{ lines, count, subtotal, ready, add, setQty, updateLine, remove, clear }}>{children}</Ctx.Provider>;
}

/* ============ Wishlist (guest, localStorage) ============ */
let memoryWishlist: number[] | null = null;
function loadWishlist(): number[] {
  if (memoryWishlist) return memoryWishlist;
  try {
    const parsed = JSON.parse(localStorage.getItem("sz_wishlist") || "[]");
    memoryWishlist = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "number") : [];
  } catch { memoryWishlist = []; }
  return memoryWishlist!;
}
function saveWishlist(ids: number[]) {
  memoryWishlist = ids;
  try { localStorage.setItem("sz_wishlist", JSON.stringify(ids)); } catch {}
}
export function useWishlist() {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => { setIds([...loadWishlist()]);
    const h = () => setIds([...loadWishlist()]);
    window.addEventListener("sz_wishlist_changed", h);
    return () => window.removeEventListener("sz_wishlist_changed", h);
  }, []);
  const toggle = (id: number) => {
    const cur = loadWishlist();
    saveWishlist(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    setIds([...loadWishlist()]);
    window.dispatchEvent(new Event("sz_wishlist_changed"));
  };
  return { ids, toggle, has: (id: number) => ids.includes(id) };
}

/* ============ Toast ============ */
export function toast(msg: string) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
