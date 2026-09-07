"use client";
import { useEffect, useState } from "react";
import { toast } from "./store";

/* Browser push opt-in.
   variant="card" → order success page: manual Enable button (the global
   PushNudge popup handles the sitewide ask — the native permission prompt is
   NEVER fired automatically on page load).
   variant="row" → account page ON/OFF toggle. */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

export default function PushOptIn({ phone, code, variant = "card" }: { phone?: string; code?: string; variant?: "card" | "row" }) {
  const [state, setState] = useState<State>("loading");

  /* shared: subscribe this browser + link the phone (account or order phone) */
  const subscribeNow = async (): Promise<boolean> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      if (!publicKey) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as any });
      }
      let sendPhone = phone || "";
      if (!sendPhone) {
        try {
          const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null));
          sendPhone = me?.customer?.phone || "";
        } catch {}
      }
      await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone: sendPhone }) });
      try { localStorage.removeItem("sz_push_off"); } catch {}
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      let off = false;
      try { off = localStorage.getItem("sz_push_off") === "1"; } catch {}

      // already subscribed on this device?
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const r = await fetch("/api/push?endpoint=" + encodeURIComponent(sub.endpoint));
          const j = await r.json().catch(() => ({}));
          if (j.subscribed) {
            // keep the phone fresh (e.g. just-logged-in / new order phone)
            const p = phone || "";
            if (p) await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone: p }) }).catch(() => {});
            return setState("on");
          }
        }
      } catch {}

      if (off) return setState("off"); // user turned it off from account settings
      // permission "default" or "granted" → the manual Enable button handles it
      // (native prompt fires only from the user's click — never automatically)
      setState("off");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    if (state === "busy" || state === "on") return;
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("denied"); return; }
      const ok = await subscribeNow();
      setState(ok ? "on" : "off");
      if (ok) toast("Order update notifications on ✓");
    } catch {
      setState("off");
      toast("Could not enable notifications");
    }
  };

  const disable = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe().catch(() => {});
      }
    } catch {}
    try { localStorage.setItem("sz_push_off", "1"); } catch {}
    setState("off");
    toast("Order updates off");
  };

  if (state === "loading" || state === "unsupported") return null;

  if (variant === "row") {
    return (
      <div className="push-row">
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 13.5 }}>Order update notifications</b>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {state === "denied" ? "Browser-e blocked — settings theke allow korun" : state === "on" ? "Status change holei notification paben" : "Confirm / shipped / delivered holei janaben"}
          </div>
        </div>
        {state === "on" ? (
          <button type="button" className="abtn sm" onClick={disable}>Turn off</button>
        ) : state === "denied" ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Blocked</span>
        ) : (
          <button type="button" className="abtn sm" onClick={enable} disabled={state === "busy"} aria-busy={state === "busy" || undefined}>
            {state === "busy" ? <span className="spinner" aria-hidden="true" /> : null}Enable
          </button>
        )}
      </div>
    );
  }

  // card (order success page)
  if (state === "on") {
    return (
      <div className="push-optin done">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
        <span>Order update notifications <b>ON</b>{code ? <> — status change hole janaben</> : null}</span>
      </div>
    );
  }
  if (state === "denied") return null;
  return (
    <div className="push-optin">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      <div style={{ flex: 1, textAlign: "left" }}>
        <b style={{ fontSize: 13 }}>Order update notifications</b>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Confirm, shipped, delivered — sob status e notification paben</div>
      </div>
      <button type="button" className="abtn sm" onClick={enable} disabled={state === "busy"} aria-busy={state === "busy" || undefined}>
        {state === "busy" ? <span className="spinner" aria-hidden="true" /> : null}Enable
      </button>
    </div>
  );
}
