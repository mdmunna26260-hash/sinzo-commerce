"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "./store";

/* Push notification NUDGE — compact, non-intrusive.
   Shows AFTER the visitor has engaged: ≥25s on the site AND scrolled ≥40%
   (short pages that can't scroll count as scrolled once the time is up).
   The browser's native permission prompt fires ONLY when the visitor taps
   "Notify Me →" — never automatically on page load.
   "Maybe later" / × → hides for 3 days. Denied → never again.
   Account-page OFF flag (sz_push_off) is always respected. */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const LATER_KEY = "sz_push_later_at";
const OFF_KEY = "sz_push_off";
const DELAY_MS = 25_000; // 25s — inside the requested 20-30s window
const SCROLL_RATIO = 0.4;
const LATER_DAYS = 3;

export default function PushNudge() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (window.location.pathname.startsWith("/admin")) return;

    let off = false;
    let later = 0;
    try {
      off = localStorage.getItem(OFF_KEY) === "1";
      later = Number(localStorage.getItem(LATER_KEY) || 0);
    } catch {}
    if (off) return;
    if (Date.now() - later < LATER_DAYS * 86400000) return;
    if (Notification.permission === "denied") return;

    // already granted earlier → silent re-subscribe check, never the popup
    if (Notification.permission === "granted") {
      const t = setTimeout(async () => {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (!sub) return;
          const chk = await fetch("/api/push?endpoint=" + encodeURIComponent(sub.endpoint)).then((r) => r.json()).catch(() => ({}));
          if (chk?.subscribed) return;
          let phone = "";
          try { phone = localStorage.getItem("sz_user_phone") || ""; } catch {}
          if (!phone) { try { const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)); phone = me?.customer?.phone || ""; } catch {} }
          await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone }) }).catch(() => {});
        } catch {}
      }, 2500);
      return () => clearTimeout(t);
    }

    const startedAt = Date.now();
    let timer: any = null;
    const ready = () => {
      if (shownRef.current) return;
      if (Date.now() - startedAt < DELAY_MS) return;
      // scroll ≥40% — pages too short to scroll count as satisfied
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const ratio = scrollable > 120 ? window.scrollY / scrollable : 1;
      if (ratio < SCROLL_RATIO) return;
      shownRef.current = true;
      cleanup();
      setShow(true);
    };
    const on = () => { if (!timer) timer = setInterval(ready, 800); };
    function cleanup() { if (timer) { clearInterval(timer); timer = null; } window.removeEventListener("scroll", on); }
    on();
    return cleanup;
  }, []);

  const hide = (remember: boolean) => {
    setShow(false);
    if (remember) { try { localStorage.setItem(LATER_KEY, String(Date.now())); } catch {} }
  };

  const notifyMe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission(); // native prompt — user-gesture driven
      if (perm !== "granted") { hide(true); return; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      if (publicKey) {
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as any });
        let phone = "";
        try { phone = localStorage.getItem("sz_user_phone") || ""; } catch {}
        if (!phone) { try { const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)); phone = me?.customer?.phone || ""; } catch {} }
        await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone }) });
        try { localStorage.removeItem(OFF_KEY); } catch {}
        toast("Notifications on ✓");
      }
    } catch {}
    setShow(false);
  };

  if (!show) return null;
  return (
    <div className="push-nudge" role="dialog" aria-label="Notification opt-in">
      <button className="push-nudge-x" aria-label="Close" onClick={() => hide(true)}>×</button>
      <div className="push-nudge-icon" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        <i />
      </div>
      <div className="push-nudge-body">
        <b>Get notified</b>
        <span>About new drops, discount offers &amp; limited-stock.</span>
        <div className="push-nudge-actions">
          <button className="push-nudge-go" onClick={notifyMe} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            <span style={busy ? { marginLeft: 6 } : undefined}>Notify Me →</span>
          </button>
          <button className="push-nudge-later" onClick={() => hide(true)}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}
