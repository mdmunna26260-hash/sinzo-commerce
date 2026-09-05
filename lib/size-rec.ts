/* Size recommendation engine — PRODUCT-AWARE.
   Golden rule: a size may ONLY be recommended if it exists in the product's
   configured sizes. No hardcoded XL fallback — when the data can't support a
   confident pick, we return "uncertain" and the UI shows the size-chart
   fallback message instead. */

export type SizeSystem = "numeric" | "alpha" | "custom";

export type RecResult =
  | { status: "ok"; size: string; note?: "closest" }
  | { status: "oos"; size: string; alt?: string }
  | { status: "uncertain" };

export const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "XXXL", "4XL"];

/* ---------- classify the product's sizing system from its ACTUAL sizes ---------- */
export function classifySizeSystem(sizes: string[]): SizeSystem {
  const list = sizes.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return "custom";
  const nums = list.filter((s) => /^\d{1,3}$/.test(s));
  if (nums.length >= 2 && nums.length >= list.length * 0.6) return "numeric";
  const letters = list.filter((s) => SIZE_ORDER.includes(s.toUpperCase()));
  if (letters.length >= list.length * 0.6) return "alpha";
  return "custom";
}

/* ---------- numeric (pants/trousers) waist estimate, in inches ----------
   50kg → 28 · +2 inch per 7kg · tall (≥178) +0.5 · short (≤155) −0.5.
   If the product's size chart has real waist measurements, those values are
   used for matching instead of the nominal size number (see recommendSize). */
export function estimateWaist(heightCm: number, weightKg: number): number {
  let waist = 28 + ((weightKg - 50) * 2) / 7;
  if (heightCm >= 178) waist += 0.5;
  else if (heightCm <= 155) waist -= 0.5;
  return Math.min(46, Math.max(24, waist));
}

/* ---------- alphabetic target index in SIZE_ORDER (0..9) ----------
   Height points + BMI points, with safety floors for extreme builds. */
export function alphaTargetIndex(heightCm: number, weightKg: number): number {
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  const hPts = heightCm < 158 ? 0 : heightCm < 165 ? 1 : heightCm < 172 ? 2 : heightCm < 179 ? 3 : 4;
  const bPts = bmi < 18.5 ? 0 : bmi < 22 ? 1 : bmi < 26 ? 2 : bmi < 30 ? 3 : 4;
  let idx = 2 + Math.floor((hPts + bPts) / 2);
  if (bPts === 2 && bmi >= 25) idx += 1; // upper-normal build (BMI 25–26) → size up
  if (bmi >= 35) idx = Math.max(idx, 6); // XXL floor
  else if (bmi >= 30) idx = Math.max(idx, 5); // XL floor
  if (bmi < 17) idx = Math.min(idx, 2); // very slim → S cap
  if (weightKg >= 95) idx = Math.max(idx, 6);
  else if (weightKg >= 85) idx = Math.max(idx, 5);
  if (weightKg < 40 && heightCm < 160) idx = Math.min(idx, 3);
  return Math.min(SIZE_ORDER.length - 1, Math.max(0, idx));
}

/* ---------- main recommendation ----------
   Returns ONLY sizes from `sizes` (the product's configured options).
   Stock status is reported separately; an out-of-stock pick comes with the
   closest in-stock alternative when one is confidently near. */
export function recommendSize(opts: {
  heightCm: number;
  weightKg: number;
  sizes: string[];
  stockMap?: Record<string, number>;
  waistChart?: Record<string, number>; // size → real waist measurement (from product size chart)
}): RecResult {
  const { heightCm: h, weightKg: w, sizes } = opts;
  const stockMap = opts.stockMap || {};
  const waistChart = opts.waistChart || {};
  if (!sizes.length) return { status: "uncertain" };
  const stockOf = (s: string) => stockMap[s] ?? 0;
  const sys = classifySizeSystem(sizes);

  /* NUMERIC — pants/trousers/jeans: return a waist number, NEVER a letter */
  if (sys === "numeric") {
    const values = sizes
      .map((s) => ({ s, v: waistChart[s] ?? parseFloat(s) }))
      .filter((x) => Number.isFinite(x.v));
    if (!values.length) return { status: "uncertain" };
    const waist = estimateWaist(h, w);
    let best = values[0];
    let bestD = Math.abs(best.v - waist);
    for (const it of values) {
      const d = Math.abs(it.v - waist);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && it.v > best.v)) {
        best = it;
        bestD = d;
      }
    }
    if (bestD > 3.5) return { status: "uncertain" }; // this product's size run doesn't cover the body
    if (stockOf(best.s) > 0) return { status: "ok", size: best.s, note: bestD > 1.51 ? "closest" : undefined };
    let alt: string | undefined;
    let altD = 3.001;
    for (const it of values) {
      if (it.s === best.s || stockOf(it.s) <= 0) continue;
      const d = Math.abs(it.v - waist);
      if (d < altD) {
        alt = it.s;
        altD = d;
      }
    }
    return { status: "oos", size: best.s, alt };
  }

  /* ALPHABETIC — S/M/L/XL: return one of the product's actual letters */
  if (sys === "alpha") {
    const idx = alphaTargetIndex(h, w);
    const idxOf = (s: string) => SIZE_ORDER.indexOf(s.trim().toUpperCase());
    let best: string | null = null;
    let bestD = 99;
    for (const s of sizes) {
      const si = idxOf(s);
      if (si === -1) continue;
      const d = Math.abs(si - idx);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (!best || bestD > 2) return { status: "uncertain" };
    if (stockOf(best) > 0) return { status: "ok", size: best, note: bestD === 2 ? "closest" : undefined };
    let alt: string | undefined;
    let altD = 2.001;
    for (const s of sizes) {
      if (s === best || stockOf(s) <= 0) continue;
      const si = idxOf(s);
      if (si === -1) continue;
      const d = Math.abs(si - idx);
      if (d < altD) {
        alt = s;
        altD = d;
      }
    }
    return { status: "oos", size: best, alt };
  }

  /* CUSTOM sizes — only attempt when there's a run wide enough to position in */
  if (sizes.length >= 4) {
    const bmi = w / Math.pow(h / 100, 2);
    const rank = Math.min(1, Math.max(0, (bmi - 16) / 22)) * 0.6 + Math.min(1, Math.max(0, (h - 145) / 45)) * 0.4;
    const idx = Math.min(sizes.length - 1, Math.max(0, Math.round(rank * (sizes.length - 1))));
    const s = sizes[idx];
    if (!s) return { status: "uncertain" };
    if (stockOf(s) > 0) return { status: "ok", size: s, note: "closest" };
    const alt = sizes.find((x, i) => Math.abs(i - idx) === 1 && stockOf(x) > 0);
    return { status: "oos", size: s, alt };
  }

  return { status: "uncertain" };
}

/* ---------- input validation (CM + FT/IN + weight) ----------
   Empty relevant fields → incomplete (gentle hint, no errors).
   Filled-but-invalid → clear error message, no calculation. */
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
    if (cm.trim() === "") {
      /* incomplete, handled below */
    } else {
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
      const f = Number(ft);
      const i = inEmpty ? 0 : Number(inch);
      const hv = f * 30.48 + i * 2.54;
      if (hv < 100 || hv > 230) errors.feet = "Enter a realistic height";
      else heightCm = Math.round(hv * 10) / 10;
    }
  }

  if (wt.trim() === "") {
    /* incomplete */
  } else {
    const v = Number(wt);
    if (!Number.isFinite(v) || v <= 0) errors.weight = "Enter a valid weight (20–250 kg)";
    else if (v < 20 || v > 250) errors.weight = "Weight must be between 20 and 250 kg";
    else weightKg = v;
  }

  const heightEmpty = unit === "cm" ? cm.trim() === "" : ft.trim() === "";
  const incomplete = heightEmpty || wt.trim() === "";
  return { errors, heightCm, weightKg, incomplete };
}
