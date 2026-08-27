"use client";
import { useEffect } from "react";
import { trackEvent } from "@/components/store";

/* Fires the Meta Purchase pixel (+ GA4) ONCE on the thank-you page with the SAME
   event_id the server used for Conversions API — accurate + deduplicated. */
export default function PurchaseTracker({ eid, total, ids, num }: { eid: string; total: number; ids: string[]; num: number }) {
  useEffect(() => {
    if (!eid) return;
    try {
      const key = "sz_purchase_" + eid;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    trackEvent("Purchase", {
      value: total, currency: "BDT",
      content_ids: ids, content_type: "product",
      contents: ids.map((id) => ({ id, quantity: 1 })),
      num_items: num,
    }, { eventId: eid });
    // strip eid so a manual refresh cannot refire (event_id dedup would also catch it)
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("eid");
      window.history.replaceState({}, "", u.toString());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
