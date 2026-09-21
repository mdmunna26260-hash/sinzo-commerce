import type { SettingsMap } from "./settings";

/* Returns & Exchange policy — ONE source of truth.
   The page a customer reads (/returns) and the `MerchantReturnPolicy` Google reads (PDP JSON-LD)
   both come from here. That is the whole point: when the owner changes the window in
   admin → Policies, the visible page and the structured data move together and cannot contradict
   each other (Google's rule is that the marked-up policy must be the one the site actually
   shows, and a mismatch is what silently drops the annotation).

   Every value has a default so the page is complete on a fresh install, before anyone opens
   admin → Policies. The defaults are what this store's existing markup already claimed
   (7 days, free return courier, return by courier) — not new terms invented here. */
export type Policy = {
  returnDays: number;
  freeReturnCourier: boolean;
  damageReportHours: number;
  exchangeNote: string;
  refundTime: string;
  refundMethod: string;
  nonReturnable: string[];
  note: string;
  updated: string;
};

export const POLICY_DEFAULTS = {
  returnDays: 7,
  freeReturnCourier: true,
  damageReportHours: 48,
  exchangeNote: "Sizing or colour not right? We swap it for another size or colour, subject to stock. You can also put the amount towards a different product.",
  refundTime: "3–5 working days",
  refundMethod: "bKash, Nagad or a bank transfer",
  // one per line in admin — the page renders them as a list
  nonReturnable: [
    "Innerwear and undergarments, for hygiene reasons.",
    "Anything worn, washed, altered or damaged after delivery.",
    "Items missing their original tags, packaging or invoice.",
  ].join("\n"),
  note: "",
  updated: "September 2026",
};

const txt = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : d;
};

export function readPolicy(s?: SettingsMap): Policy {
  const p: any = (s && (s as any).policies) || {};
  return {
    returnDays: num(p.returnDays, POLICY_DEFAULTS.returnDays),
    // an unchecked checkbox arrives as false; anything absent keeps the default
    freeReturnCourier: p.freeReturnCourier === undefined || p.freeReturnCourier === null
      ? POLICY_DEFAULTS.freeReturnCourier
      : !!p.freeReturnCourier,
    damageReportHours: num(p.damageReportHours, POLICY_DEFAULTS.damageReportHours),
    exchangeNote: txt(p.exchangeNote, POLICY_DEFAULTS.exchangeNote),
    refundTime: txt(p.refundTime, POLICY_DEFAULTS.refundTime),
    refundMethod: txt(p.refundMethod, POLICY_DEFAULTS.refundMethod),
    nonReturnable: txt(p.nonReturnable, POLICY_DEFAULTS.nonReturnable)
      .split("\n").map((x) => x.trim()).filter(Boolean),
    note: typeof p.note === "string" ? p.note.trim() : "",
    updated: txt(p.updated, POLICY_DEFAULTS.updated),
  };
}
