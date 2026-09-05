"use client";
import { useEffect } from "react";
import { toast } from "./store";

/* AUTO browser push notifications.
   Browsers only allow the permission prompt after a user gesture, so:
   - permission ALREADY granted  → silently (re)subscribe this device, no UI
   - permission default          → the FIRST tap/click/keypress anywhere on the
     storefront fires the native prompt automatically (no Enable button)
   - permission denied           → never asked again
   - dismissed                   → re-asked once per 7 days (no nagging)
   Users can still turn it off from the account page (sz_push_off flag). */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const ASK_KEY = "sz_push_asked_at";
const OFF_KEY = "sz_push_off";

export default function PushAuto() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (window.location.pathname.startsWith("/admin")) return;

    let off = false;
    try { off = localStorage.getItem(OFF_KEY) === "1"; } catch {}

    const subscribeAndSave = async (announce: boolean) => {
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const { publicKey } = await fetch("/api/push").then((r) => r.json());
          if (!publicKey) return;
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as any });
        } else {
          // already subscribed on this device — skip if the server already knows it
          const chk = await fetch("/api/push?endpoint=" + encodeURIComponent(sub.endpoint)).then((r) => r.json()).catch(() => ({}));
          if (chk?.subscribed) return;
        }
        let phone = "";
        try {
          const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null));
          phone = me?.customer?.phone || "";
        } catch {}
        await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone }) });
        if (announce) toast("Order update notifications on ✓");
      } catch {}
    };

    // granted earlier → silently make sure this device is subscribed
    if (Notification.permission === "granted") {
      if (off) return;
      const t = setTimeout(() => subscribeAndSave(false), 2500);
      return () => clearTimeout(t);
    }
    if (Notification.permission !== "default") return; // denied → never ask
    if (off) return; // user turned it off from account settings

    // default → auto-prompt on the first user gesture (browser requirement),
    // at most once every 7 days if it was dismissed
    let last = 0;
    try { last = Number(localStorage.getItem(ASK_KEY) || 0); } catch {}
    if (Date.now() - last < 7 * 86400000) return;

    const ask = () => {
      evs.forEach((e) => window.removeEventListener(e, ask));
      try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch {}
      Notification.requestPermission()
        .then((p) => { if (p === "granted") subscribeAndSave(true); })
        .catch(() => {});
    };
    const evs = ["pointerdown", "touchstart", "keydown"] as const;
    evs.forEach((e) => window.addEventListener(e, ask, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, ask));
  }, []);
  return null;
}
