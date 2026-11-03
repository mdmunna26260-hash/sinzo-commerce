/* Central SEO keyword set + search synonyms.
   Goal: someone typing "sinzo", "shinzo", "sinjo", "pant", "baggy", "wide leg baggy",
   "jacket" etc. should land on this store — via meta keywords (indexing) AND via the
   on-site search (synonym expansion), so misspellings and generic garment words still
   find our products. */

/** Brand spellings people actually type (incl. common misspellings). */
export const BRAND_KEYWORDS = [
  "sinzo", "shinzo", "sinjo", "sinzo bd", "sinzo bangladesh", "sinzoffcial",
  "sinzo shop", "sinzo store", "sinzo online",
];

/** Generic garment / intent keywords — Bangladesh e-commerce search terms. */
export const GARMENT_KEYWORDS = [
  "pant", "pants", "baggy", "baggy pant", "wide leg", "wide leg baggy", "trousers",
  "jacket", "coat", "outerwear", "leather jacket", "leather", "bomber jacket",
  "shirt", "dress", "knitwear", "knit", "denim", "denim jacket",
  "tshirt", "t-shirt", "t shirt", "tee", "oversized tee",
  "tote bag", "bag", "leather bag", "leather tote",
  "old money", "old money aesthetic", "old money style", "quiet luxury", "minimal luxury",
  "cash on delivery", "cod", "dhaka", "bangladesh", "online shopping bangladesh",
];

/** Combined keyword string for meta tags. */
export function seoKeywords(extra: string[] = []): string {
  const all = [...BRAND_KEYWORDS, ...GARMENT_KEYWORDS, ...extra]
    .map((k) => String(k || "").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(all)].join(", ");
}

/* On-site search synonyms: query term → extra terms that should also match.
   "pant" must find "trousers", "baggy" must find "wide leg", "shinzo" must find "sinzo". */
const SYNONYMS: Record<string, string[]> = {
  pant: ["pants", "trousers", "pant"],
  pants: ["pant", "trousers"],
  trousers: ["pant", "pants"],
  baggy: ["wide leg", "loose", "baggy", "wide-leg"],
  "wide": ["wide leg", "wide-leg", "baggy"],
  leg: ["wide leg", "wide-leg", "trousers", "pant"],
  jacket: ["jacket", "coat", "blazer", "outerwear"],
  coat: ["coat", "jacket", "outerwear"],
  shinzo: ["sinzo", "shinzo", "sinjo"],
  sinjo: ["sinzo", "shinzo", "sinjo"],
  sinzo: ["sinzo", "shinzo", "sinjo"],
  shirt: ["shirt", "shirts"],
  dress: ["dress", "dresses", "midi"],
  knit: ["knit", "knitwear", "sweater"],
  bag: ["bag", "tote", "tote bag"],
  tote: ["tote", "bag", "tote bag"],
};

const BRAND_SET = new Set(BRAND_KEYWORDS);

/** True when a single search term is just the brand (sinzo / shinzo / sinjo …) —
   a brand-only query should show the whole catalogue, not zero products. */
export function isBrandTerm(t: string): boolean {
  return BRAND_SET.has(String(t || "").trim().toLowerCase());
}

/** Expand a raw query into matchable terms (original + synonyms), deduped, capped. */
export function expandTerms(raw: string): string[] {
  const base = String(raw || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, "").toLowerCase())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  const out = new Set<string>();
  for (const t of base) {
    out.add(t);
    for (const s of SYNONYMS[t] || []) out.add(s);
  }
  // multi-word synonyms like "wide leg" also match as individual words via "wide"/"leg"
  return [...out].slice(0, 12);
}
