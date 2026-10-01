/* Height/weight-only, product-aware clothing size guide.
   Height-adjusted weight estimates body proportions; the product/category chart
   takes priority over generic shirt/pants sizing. These are fitting heuristics,
   NOT a claim that height and weight can guarantee an exact fit for every body. */
export type GarmentType = "shirt" | "pants" | "wide-leg-pants" | "unknown";
export type SizeSystem = "numeric" | "alpha" | "mixed" | "custom";
export const ALPHA_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL", "6XL"];
const SHIRT_CHEST = [34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54];
const PANTS_WAIST = [26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46];

export function normAlpha(size: string): string {
  const s = size.trim().toUpperCase().replace(/\s+/g, "");
  return ({ "2XL": "XXL", "3XL": "XXXL", "XXXXL": "4XL", "XXXXXL": "5XL", "XXXXXXL": "6XL", "2XS": "XXS" } as Record<string, string>)[s] || s;
}
function labelParts(label: string): { alpha?: string; numeric?: number } {
  const upper = label.trim().toUpperCase();
  const alphaToken = upper.match(/(?:^|[\s(/-])(XXS|2XS|XS|S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL|XXXXXXL|[2-6]XL)(?=$|[\s)/-])/);
  const alpha = ALPHA_ORDER.includes(normAlpha(upper)) ? normAlpha(upper) : alphaToken ? normAlpha(alphaToken[1]) : undefined;
  const number = upper.match(/(?:^|[\s(/-]|\bW)(\d{2}(?:\.\d+)?)(?=$|[\s()"/\u2033-])/);
  return { alpha, ...(number ? { numeric: Number(number[1]) } : {}) };
}
export function classifySizeSystem(sizes: string[]): SizeSystem {
  const parts = sizes.map(labelParts);
  const numeric = parts.some((s) => s.numeric !== undefined), alpha = parts.some((s) => s.alpha !== undefined);
  return numeric && alpha ? "mixed" : numeric ? "numeric" : alpha ? "alpha" : "custom";
}
export function detectGarmentType(title = "", category = ""): GarmentType {
  const text = `${title} ${category}`.toLowerCase();
  if (/wide[\s_-]*leg|palazzo|ও[য়য়]াইড.*লেগ/.test(text)) return "wide-leg-pants";
  if (/\b(pants?|trousers?|jeans?|joggers?|chinos?|bottoms|slacks)\b|প্যান্ট|ট্রাউজার/.test(text)) return "pants";
  if (/\b(shirts?|t[\s-]?shirts?|tees?|polo|tops|overshirts?|knitwear|sweaters?|hoodies?|jackets?|outerwear)\b|শার্ট|টি.?শার্ট/.test(text)) return "shirt";
  return "unknown";
}

/* Smooth interpolation avoids the old dead ranges at decimal weights and
   between height bands. Equivalent mass is normalized to a 170cm adult.
   Taller people of the same weight generally need a smaller waist/chest. */
const BODY_ANCHORS = [
  [35, 25, 31], [40, 26, 32], [48, 28, 34], [57, 30, 36],
  [66, 32, 38], [76, 34, 40], [87, 36, 42], [99, 38, 44],
  [112, 40, 46], [126, 42, 48], [141, 44, 50], [157, 46, 52], [175, 48, 54],
] as const;
export function estimateBody(heightCm: number, weightKg: number): { waist: number; chest: number } | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm < 140 || heightCm > 215 || weightKg < 30 || weightKg > 250) return null;
  const mass = weightKg * (170 / heightCm) ** 2;
  if (mass < BODY_ANCHORS[0][0] || mass > BODY_ANCHORS[BODY_ANCHORS.length - 1][0]) return null;
  for (let i = 1; i < BODY_ANCHORS.length; i++) {
    const a = BODY_ANCHORS[i - 1], b = BODY_ANCHORS[i];
    if (mass > b[0]) continue;
    const t = (mass - a[0]) / (b[0] - a[0]);
    return { waist: a[1] + (b[1] - a[1]) * t, chest: a[2] + (b[2] - a[2]) * t };
  }
  return null;
}

type ChartRow = { label: string; dimension: number; body: boolean };
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&quot;|&#34;/gi, '"').replace(/&prime;|&#39;|&#x27;/gi, "'").replace(/&amp;/gi, "&").trim();
}
/* Parse measurements as text, never execute/render chart HTML here. Supported:
   full/half chest, pit-to-pit, waist, CM/IN, ranges, and body-size charts. */
export function readSizeChart(html: string | null | undefined, garment: GarmentType): ChartRow[] {
  if (!html || garment === "unknown") return [];
  const tables = html.slice(0, 100_000).match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  const rows: ChartRow[] = [];
  for (const table of tables) {
    let headers: string[] = [];
    const caption = textOf(table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
    for (const row of [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 100)) {
      const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => textOf(c[1]));
      if (!cells.length) continue;
      if (cells.some((c) => /chest|bust|waist|pit.to.pit/i.test(c))) { headers = cells; continue; }
      const sizeIndex = headers.findIndex((h) => /\bsize\b/i.test(h));
      const dimensionIndex = headers.findIndex((h) => garment === "shirt" ? /chest|bust|pit.to.pit/i.test(h) : /waist/i.test(h));
      if (dimensionIndex < 0) continue;
      const label = cells[sizeIndex >= 0 ? sizeIndex : 0];
      const cell = cells[dimensionIndex] || "", header = headers[dimensionIndex];
      const values = (cell.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      if (!label || !values.length || values.length > 2) continue;
      let dimension = Math.max(...values);
      const unitText = `${cell} ${header} ${caption}`;
      const explicitInches = /["\u2033]|\bin(?:ch(?:es)?)?\b/i.test(cell) || (!/\bcm\b|centimet/i.test(cell) && /\binch(?:es)?\b/i.test(header));
      if (!explicitInches && /\bcm\b|centimet/i.test(unitText)) dimension /= 2.54;
      // Only explicit flat/half width is doubled; don't guess ambiguous columns.
      if (garment === "shirt" && /half|pit.to.pit|flat|chest\s*width/i.test(header)) dimension *= 2;
      if (!Number.isFinite(dimension) || dimension < 20 || dimension > 75) continue;
      rows.push({ label, dimension, body: /\bbody\b/i.test(header) });
    }
  }
  return rows;
}
function sameLabel(a: string, b: string): boolean {
  if (a.trim().toUpperCase() === b.trim().toUpperCase()) return true;
  const x = labelParts(a), y = labelParts(b);
  return !!(x.alpha && y.alpha && x.alpha === y.alpha) || (x.numeric !== undefined && y.numeric !== undefined && x.numeric === y.numeric);
}

type Match = { size: string; available: boolean };
export type RecResult =
  | { status: "ok" | "oos"; size: string; note?: "closest"; garment: GarmentType; source: "chart" | "rules"; numericSize?: string; alphaSize?: string; matches: Match[] }
  | { status: "uncertain"; reason?: "measurements" | "product" | "range" };

export function recommendSize(opts: {
  heightCm: number; weightKg: number; sizes: string[]; stockMap?: Record<string, number>;
  productTitle?: string; categoryName?: string; categorySlug?: string; sizeChartHtml?: string | null;
}): RecResult {
  const body = estimateBody(opts.heightCm, opts.weightKg);
  if (!body) return { status: "uncertain", reason: "measurements" };
  const sizes = [...new Set(opts.sizes.filter((s) => typeof s === "string" && s.trim()))];
  if (!sizes.length) return { status: "uncertain", reason: "product" };
  let garment = detectGarmentType(opts.productTitle, `${opts.categoryName || ""} ${opts.categorySlug || ""}`);
  if (garment === "unknown" && !opts.productTitle && !opts.categoryName && !opts.categorySlug) {
    const numeric = sizes.map(labelParts).map((s) => s.numeric).filter((n): n is number => n !== undefined);
    garment = numeric.length && Math.min(...numeric) <= 34 ? "pants" : "shirt";
  }
  if (garment === "unknown") return { status: "uncertain", reason: "product" };
  const shirt = garment === "shirt";
  const style = opts.productTitle || "";
  // Wide legs change leg room, NOT the waist size. No arbitrary waist upsize.
  const ease = shirt ? /oversized|relaxed|loose/i.test(style) ? 4 : /slim|fitted/i.test(style) ? 1.5 : 2 : 0;
  const bodyDimension = shirt ? body.chest : body.waist;
  const defaults = shirt ? SHIRT_CHEST : PANTS_WAIST;
  const chart = readSizeChart(opts.sizeChartHtml, garment);
  const chartHasMatches = chart.some((r) => sizes.some((s) => sameLabel(s, r.label)));
  const candidates = sizes.flatMap((size) => {
    const parts = labelParts(size);
    const foreignNumeric = /(?:^|[\s(/])(?:EU|UK|US)\s*\d|collar|neck/i.test(size);
    const row = chart.find((r) => sameLabel(size, r.label)) || (!foreignNumeric && parts.numeric !== undefined
      ? chart.find((r) => Math.abs(r.dimension + (r.body ? ease : 0) - parts.numeric!) < 0.5)
      : undefined);
    const alphaIndex = parts.alpha ? ALPHA_ORDER.indexOf(parts.alpha) : -1;
    // Shirt numbers mean chest inches (38/40/42); pants numbers mean waist
    // inches (28/30/32). Collar/EU/custom labels require an explicit chart.
    const fallback = !foreignNumeric && parts.numeric !== undefined && parts.numeric >= (shirt ? 30 : 24) && parts.numeric <= 60
      ? parts.numeric : alphaIndex >= 0 ? defaults[alphaIndex] : undefined;
    if (chartHasMatches && !row) return [];
    const dimension = row?.dimension ?? fallback;
    if (dimension === undefined) return [];
    const target = bodyDimension + (row?.body ? 0 : ease);
    const excess = dimension - target;
    if (excess < -0.5 || excess > (shirt ? 2.5 : 2)) return [];
    return [{ size, parts, dimension, bodyChart: !!row?.body, excess, available: (opts.stockMap?.[size] ?? 0) > 0 }];
  }).sort((a, b) => a.excess - b.excess);
  if (!candidates.length) return { status: "uncertain", reason: "range" };
  const best = candidates[0];
  const equivalents = candidates.filter((c) => Math.abs(c.dimension - best.dimension) < 0.15);
  const selected = equivalents.find((c) => c.available) || best;
  const numeric = equivalents.find((c) => c.parts.numeric !== undefined);
  const alpha = equivalents.find((c) => c.parts.alpha !== undefined);
  const guideDimension = selected.dimension + (selected.bodyChart ? ease : 0);
  const nearestAlpha = defaults.map((dimension, index) => ({ dimension, index })).sort((a, b) => Math.abs(a.dimension - guideDimension) - Math.abs(b.dimension - guideDimension))[0];
  return {
    status: selected.available ? "ok" : "oos", size: selected.size, garment,
    source: chartHasMatches ? "chart" : "rules", ...(selected.excess > 1.5 ? { note: "closest" as const } : {}),
    numericSize: numeric ? String(numeric.parts.numeric) : String(Math.round(guideDimension / 2) * 2),
    alphaSize: alpha ? (normAlpha(alpha.size) === alpha.parts.alpha ? alpha.size : alpha.parts.alpha) : Math.abs(nearestAlpha.dimension - guideDimension) <= 1.5 ? ALPHA_ORDER[nearestAlpha.index] : undefined,
    matches: equivalents.map(({ size, available }) => ({ size, available })),
  };
}

export type RecInputErrors = { height?: string; feet?: string; inches?: string; weight?: string };
export function validateRecInput(opts: { unit: "cm" | "ft"; cm: string; ft: string; inch: string; wt: string }): { errors: RecInputErrors; heightCm: number | null; weightKg: number | null; incomplete: boolean } {
  const { unit, cm, ft, inch, wt } = opts;
  const errors: RecInputErrors = {};
  let heightCm: number | null = null, weightKg: number | null = null;
  if (unit === "cm") {
    if (cm.trim()) {
      const value = Number(cm);
      if (!Number.isFinite(value) || value < 100 || value > 230) errors.height = "Height must be between 100 and 230 cm";
      else heightCm = value;
    }
  } else {
    if (ft.trim()) {
      const value = Number(ft);
      if (!Number.isInteger(value) || value < 3 || value > 7) errors.feet = "Feet must be a whole number between 3 and 7";
    }
    if (inch.trim()) {
      const value = Number(inch);
      if (!Number.isFinite(value) || value < 0 || value >= 12) errors.inches = "Inches must be between 0 and less than 12";
    }
    if (ft.trim() && !errors.feet && !errors.inches) {
      const value = Number(ft) * 30.48 + (inch.trim() ? Number(inch) : 0) * 2.54;
      if (value < 100 || value > 230) errors.feet = "Enter a realistic height (100–230 cm)";
      else heightCm = Math.round(value * 10) / 10;
    }
  }
  if (wt.trim()) {
    const value = Number(wt);
    if (!Number.isFinite(value) || value < 20 || value > 250) errors.weight = "Weight must be between 20 and 250 kg";
    else weightKg = value;
  }
  return { errors, heightCm, weightKg, incomplete: (unit === "cm" ? !cm.trim() : !ft.trim()) || !wt.trim() };
}
