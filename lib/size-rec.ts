/* Size recommendation — EXACT RULE-BASED SYSTEM.
   Rules (height in total inches, weight kg, inclusive ranges):

   5'4"–5'6" : 42-49 → P28/S · 50-60 → P32/M · 61-71 → P34/L · 72-80 → P36/XL · 81-85 → P38/XXXL
   5'7"–5'9" : 42-49 → P28(-) · 51-59 → P30/M · 60-70 → P32/L · 71-80 → P34/XL · 81-90 → P36/XXL · 91-95 → P38/XXXL · 96-100 → P40/4XL
   5'10"–6'0": 50-72 → P32/L · 73-80 → P34/XL

   Anything outside the table → "uncertain" (UI shows the size-chart fallback).
   The recommendation is ONLY shown if the size exists in the product's
   configured sizes (a safe one-step alternative may be offered when the rule
   size is missing). Numeric products get pants numbers; alphabetic products
   get letters. Never mixed. Never a hardcoded XL. */

export type SizeSystem = "numeric" | "alpha" | "custom";

export type RecResult =
  | { status: "ok"; size: string; note?: "closest" }
  | { status: "oos"; size: string }
  | { status: "uncertain" };

/* alphabetic universe in ascending order (3XL ≡ XXXL) */
export const ALPHA_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL"];

export function normAlpha(s: string): string {
  return s.trim().toUpperCase().replace(/^3XL$/, "XXXL");
}

/* ---------- classify the product's sizing system from its ACTUAL sizes ---------- */
export function classifySizeSystem(sizes: string[]): SizeSystem {
  const list = sizes.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return "custom";
  const nums = list.filter((s) => /^\d{1,3}$/.test(s));
  if (nums.length >= 2 && nums.length >= list.length * 0.6) return "numeric";
  const letters = list.filter((s) => ALPHA_ORDER.includes(normAlpha(s)));
  if (letters.length >= list.length * 0.6) return "alpha";
  return "custom";
}

/* ---------- the rule table ---------- */
type Band = { lo: number; hi: number; pants: string; alpha?: string };
type Rule = { minIn: number; maxIn: number; bands: Band[] };

const RULES: Rule[] = [
  {
    minIn: 64, maxIn: 66, // 5'4" – 5'6"
    bands: [
      { lo: 42, hi: 49, pants: "28", alpha: "S" },
      { lo: 50, hi: 60, pants: "32", alpha: "M" },
      { lo: 61, hi: 71, pants: "34", alpha: "L" },
      { lo: 72, hi: 80, pants: "36", alpha: "XL" },
      { lo: 81, hi: 85, pants: "38", alpha: "XXXL" },
    ],
  },
  {
    minIn: 67, maxIn: 69, // 5'7" – 5'9"
    bands: [
      { lo: 42, hi: 49, pants: "28" }, // alphabetic not defined in the rules for this row
      { lo: 51, hi: 59, pants: "30", alpha: "M" },
      { lo: 60, hi: 70, pants: "32", alpha: "L" },
      { lo: 71, hi: 80, pants: "34", alpha: "XL" },
      { lo: 81, hi: 90, pants: "36", alpha: "XXL" },
      { lo: 91, hi: 95, pants: "38", alpha: "XXXL" },
      { lo: 96, hi: 100, pants: "40", alpha: "4XL" },
    ],
  },
  {
    minIn: 70, maxIn: 72, // 5'10" – 6'0"
    bands: [
      { lo: 50, hi: 72, pants: "32", alpha: "L" },
      { lo: 73, hi: 80, pants: "34", alpha: "XL" },
    ],
  },
];

/* rule lookup — height is normalized to whole inches so a CM input like
   170cm (66.93in) lands on 5'7" exactly like a manual FT/IN entry */
export function ruleFor(heightCm: number, weightKg: number): { pants: string; alpha?: string } | null {
  const totalIn = Math.round(heightCm / 2.54);
  for (const rule of RULES) {
    if (totalIn < rule.minIn || totalIn > rule.maxIn) continue;
    for (const b of rule.bands) {
      if (weightKg >= b.lo && weightKg <= b.hi) return { pants: b.pants, alpha: b.alpha };
    }
    return null; // height covered, weight outside every band → undefined range
  }
  return null; // height outside all rule ranges
}

/* ---------- main recommendation ---------- */
export function recommendSize(opts: {
  heightCm: number;
  weightKg: number;
  sizes: string[]; // the product's configured sizes
  stockMap?: Record<string, number>; // size → stock
}): RecResult {
  const { heightCm: h, weightKg: w, sizes } = opts;
  const stockMap = opts.stockMap || {};
  if (!sizes.length) return { status: "uncertain" };

  const rule = ruleFor(h, w);
  if (!rule) return { status: "uncertain" };

  const sys = classifySizeSystem(sizes);
  const stockOf = (s: string) => stockMap[s] ?? 0;

  /* NUMERIC pants → only a number, never a letter */
  if (sys === "numeric") {
    const want = rule.pants;
    const nums = sizes
      .map((s) => ({ s, v: parseFloat(s) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => a.v - b.v);
    const exact = nums.find((x) => x.v === parseFloat(want));
    if (exact) return stockOf(exact.s) > 0 ? { status: "ok", size: exact.s } : { status: "oos", size: exact.s };
    // exact size not configured → only a SAFE alternative (size UP, within 4 waist units)
    if (parseFloat(want) < nums[0].v && nums[0].v - parseFloat(want) <= 4)
      return stockOf(nums[0].s) > 0 ? { status: "ok", size: nums[0].s, note: "closest" } : { status: "oos", size: nums[0].s };
    const next = nums.find((x) => x.v > parseFloat(want));
    if (next && next.v - parseFloat(want) <= 4)
      return stockOf(next.s) > 0 ? { status: "ok", size: next.s, note: "closest" } : { status: "oos", size: next.s };
    return { status: "uncertain" }; // e.g. 40-body vs a 28-30-only run → do NOT guess
  }

  /* ALPHABETIC shirt → only a letter from the rules */
  if (sys === "alpha") {
    const want = rule.alpha ? normAlpha(rule.alpha) : null;
    if (!want) return { status: "uncertain" }; // rules define no letter for this combo
    const idxOf = (s: string) => ALPHA_ORDER.indexOf(normAlpha(s));
    const items = sizes
      .map((s) => ({ s, i: idxOf(s) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i);
    const exact = items.find((x) => normAlpha(x.s) === want);
    if (exact) return stockOf(exact.s) > 0 ? { status: "ok", size: exact.s } : { status: "oos", size: exact.s };
    // missing letter → only a SAFE alternative: one step up when the rule size sits below the range or in a single-size gap
    if (wantIdx(want) < items[0].i) {
      const alt = items[0];
      if (alt.i - wantIdx(want) === 1) return stockOf(alt.s) > 0 ? { status: "ok", size: alt.s, note: "closest" } : { status: "oos", size: alt.s };
      return { status: "uncertain" };
    }
    if (wantIdx(want) > items[items.length - 1].i) return { status: "uncertain" };
    const next = items.find((x) => x.i > wantIdx(want));
    if (next && next.i - wantIdx(want) === 1)
      return stockOf(next.s) > 0 ? { status: "ok", size: next.s, note: "closest" } : { status: "oos", size: next.s };
    return { status: "uncertain" };
  }

  return { status: "uncertain" }; // custom / unrecognized size system → size-chart fallback
}

function wantIdx(norm: string): number {
  return ALPHA_ORDER.indexOf(norm);
}

/* ---------- input validation (FT/IN default + CM + weight) ---------- */
export type RecInputErrors = { height?: string; feet?: string; inches?: string; weight?: string };

export function validateRecInput(opts: {
  unit: "cm" | "ft";
  cm: string;
  ft: string;
  inch: string;
  wt: string;
}): { errors: RecInputErrors; heightCm: number | null; weightKg: number | null; incomplete: boolean } {
  const { unit, cm, ft, inch, wt } = opts;
  const errors: RecInputErrors = {};
  let heightCm: number | null = null;
  let weightKg: number | null = null;

  if (unit === "cm") {
    if (cm.trim() !== "") {
      const v = Number(cm);
      if (!Number.isFinite(v) || v <= 0) errors.height = "Enter a valid height (100–230 cm)";
      else if (v < 100 || v > 230) errors.height = "Height must be between 100 and 230 cm";
      else heightCm = v;
    }
  } else {
    const ftEmpty = ft.trim() === "";
    const inEmpty = inch.trim() === "";
    if (!ftEmpty) {
      const f = Number(ft);
      if (!Number.isInteger(f) || f <= 0) errors.feet = "Feet must be a whole number (3–7)";
      else if (f < 3 || f > 7) errors.feet = "Feet must be between 3 and 7";
    }
    if (!inEmpty) {
      const i = Number(inch);
      if (!Number.isFinite(i) || i < 0 || i > 11) errors.inches = "Inches must be between 0 and 11";
    }
    if (!ftEmpty && !errors.feet && !errors.inches) {
      const hv = Number(ft) * 30.48 + (inEmpty ? 0 : Number(inch)) * 2.54;
      if (hv < 100 || hv > 230) errors.feet = "Enter a realistic height";
      else heightCm = Math.round(hv * 10) / 10;
    }
  }

  if (wt.trim() !== "") {
    const v = Number(wt);
    if (!Number.isFinite(v) || v <= 0) errors.weight = "Enter a valid weight (20–250 kg)";
    else if (v < 20 || v > 250) errors.weight = "Weight must be between 20 and 250 kg";
    else weightKg = v;
  }

  const heightEmpty = unit === "cm" ? cm.trim() === "" : ft.trim() === "";
  const incomplete = heightEmpty || wt.trim() === "";
  return { errors, heightCm, weightKg, incomplete };
}
