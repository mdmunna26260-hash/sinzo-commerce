"use client";
import { useEffect } from "react";

/* Registers the Web Push service worker once, app-wide. */
export default function PushRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // admin panel er dorkar nai
    if (window.location.pathname.startsWith("/admin")) return;
    const reg = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }, []);
  return null;
}
