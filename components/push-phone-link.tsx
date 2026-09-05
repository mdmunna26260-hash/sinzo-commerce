"use client";
import { useEffect } from "react";

/* After an order is placed, link the existing push subscription (if any) to the
   phone number used for the order — so order-status pushes reach the guest. */
export default function PushPhoneLink({ phone }: { phone: string }) {
  useEffect(() => {
    if (!phone) return;
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), phone }) });
      } catch {}
    })();
  }, [phone]);
  return null;
}
