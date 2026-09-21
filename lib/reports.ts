import type { SettingsMap } from "./settings";

/* Shared bits for the admin report pages (Profit, Stock, Couriers). Kept out of the pages so the
   three of them money-format and date-range identically — a figure must never read differently
   in two reports. */

export const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
export const pct = (n: number) => (Number.isFinite(n) ? (n * 100).toFixed(1) : "0.0") + "%";
export const units = (n: number) => (n || 0).toLocaleString("en-IN");
/* 4.6 → "4.6×" style for margin multiples; plain for counts */
export const dec = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "0");

export const RANGE_PRESETS: [string, string][] = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7", "Last 7 days"], ["30", "Last 30 days"],
  ["90", "Last 90 days"], ["month", "This month"], ["all", "All time"], ["custom", "Custom range"],
];

export type ResolvedRange = { start: Date; end: Date; label: string; preset: string };

export function resolveRange(sp: { preset?: string; from?: string; to?: string }): ResolvedRange {
  const now = new Date();
  const nowT = now.getTime();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start = new Date(nowT - 29 * 86400000); start.setHours(0, 0, 0, 0);
  let label = "Last 30 days";
  const p = sp.preset || "30";
  if (p === "today") { start = new Date(nowT); start.setHours(0, 0, 0, 0); label = "Today"; }
  else if (p === "yesterday") { start = new Date(nowT - 86400000); start.setHours(0, 0, 0, 0); end.setTime(start.getTime()); end.setHours(23, 59, 59, 999); label = "Yesterday"; }
  else if (p === "7") { start = new Date(nowT - 6 * 86400000); start.setHours(0, 0, 0, 0); label = "Last 7 days"; }
  else if (p === "90") { start = new Date(nowT - 89 * 86400000); start.setHours(0, 0, 0, 0); label = "Last 90 days"; }
  else if (p === "month") { start = new Date(now.getFullYear(), now.getMonth(), 1); label = "This month"; }
  else if (p === "all") { start = new Date(2000, 0, 1); label = "All time"; }
  else if (p === "custom" && sp.from && sp.to) {
    const s = new Date(sp.from + "T00:00:00");
    const e = new Date(sp.to + "T23:59:59");
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) { start = s; end.setTime(e.getTime()); label = `${sp.from} → ${sp.to}`; }
  }
  return { start, end, label, preset: p };
}

/* What the COURIER charges US for one parcel — admin → Settings → Courier.
   Deliberately not shipping.insideDhaka: that is what the customer pays, and the two are
   different numbers on purpose. Returns null when it was never configured (0), so a report says
   "not set" instead of quietly counting a free delivery. */
export function courierCost(s: SettingsMap, area?: string | null): number | null {
  const c: any = (s as any).courier || {};
  const raw = /INSIDE/i.test(String(area || "")) ? c.insideDhaka : c.outsideDhaka;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* Steadfast hands back free-text delivery_status values. This is the one place that decides what
   they mean, so every report classifies a parcel the same way. */
export type ParcelState = "delivered" | "rto" | "moving" | "none";
export function parcelState(o: { status?: string; courierStatus?: string | null; courierConsignmentId?: string | null }): ParcelState {
  if (!o.courierConsignmentId && !o.courierStatus && o.status !== "DELIVERED" && o.status !== "RETURNED") return "none";
  if (o.status === "DELIVERED" || /^(delivered|partial_delivered)/i.test(o.courierStatus || "")) return "delivered";
  if (o.status === "RETURNED" || /return|rto|cancel|hold|unknown|lost/i.test(o.courierStatus || "")) return "rto";
  return "moving";
}

/* A month label for the trend tables: "Sep 2026". */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};
