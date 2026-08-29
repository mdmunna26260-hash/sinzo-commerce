"use client";
import { useEffect } from "react";

/* Page transition behaviour.
   All transition styles live statically in globals.css (view-transition rules +
   pageIn keyframes) — no runtime style injection, zero per-load JS work.
   This component only handles scroll restoration. */
export default function PageTransition() {
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);
  return null;
}
