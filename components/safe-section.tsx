"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

/* One broken homepage section must not turn the storefront into the OOPS card.

   What it does catch (measured): a render-time failure inside the wrapped subtree — e.g. a review whose
   product row is gone. The section disappears, the rest of the page renders, and componentDidCatch posts
   to /api/client-error so it shows up in Admin → Tracking.

   What it CANNOT catch: errors thrown while the server *serializes* the payload — e.g. an `onError={() => …}`
   on an element handed to <Carousel> (a client component). React refuses function props across that
   boundary and the failure escapes to app/error.tsx no matter how many boundaries sit below. That class is
   prevented by the rule below, not by this component.

   Rule for anything rendered inside <Carousel> or another client component from a Server Component:
   no function props — use the client components that already handle it (SmartImg does image fallbacks). */
export default class SafeSection extends Component<{ id?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof window === "undefined") return;
    console.error("Section render error:", this.props.id, error);
    try {
      fetch("/api/client-error", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({
          message: `section ${this.props.id || "?"}: ${error?.message || "unknown"}`.slice(0, 500),
          stack: `${error?.stack || ""}\n${info?.componentStack || ""}`.slice(0, 1500),
          url: location.pathname + location.search,
        }),
      }).catch(() => {});
    } catch { /* never worsen a crash */ }
  }

  render() { return this.state.failed ? null : this.props.children; }
}
