/* Shared search helpers.
 *
 * WHY THIS EXISTS
 * Production runs on PostgreSQL (Neon), dev runs on SQLite (prisma/schema.prisma).
 * Prisma's `contains` maps to LIKE on both, but:
 *   • PostgreSQL LIKE is CASE-SENSITIVE   → { contains: "beige" } misses "BEIGE COLOR"
 *   • SQLite     LIKE is CASE-INSENSITIVE  → the bug is invisible in dev
 * `mode: "insensitive"` fixes Postgres but is REJECTED by Prisma on SQLite
 * ("Unknown argument `mode`"), so it must be applied per-connector.
 *
 * Also: a query like "white shirt" used to be matched as one literal string, so
 * typing a product's full name returned nothing. We now split on whitespace and
 * require every term (AND) — matching each term against title/tags/sku/desc/category.
 */

/** True when the connected datasource supports `mode: "insensitive"`. */
export function supportsInsensitive(): boolean {
  const url = process.env.DATABASE_URL || "";
  return /^postgres(ql)?:/i.test(url);
}

/** Case-insensitive `contains` on Postgres, plain (already CI) `contains` on SQLite. */
export function ci(value: string): Record<string, unknown> {
  return supportsInsensitive() ? { contains: value, mode: "insensitive" } : { contains: value };
}

/** Split a user query into clean terms: trim, collapse spaces, drop noise. */
export function terms(raw: string): string[] {
  return String(raw || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")   // quotes/brackets/etc. are not searchable
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 6);                          // cap work per query
}

export type SearchableField = "title" | "tags" | "sku" | "shortDesc" | "description" | "categoryName" | "orderCode";

const DEFAULT_FIELDS: SearchableField[] = ["title", "tags", "sku", "shortDesc", "description", "categoryName"];

/**
 * Build a Prisma `where` fragment for products: every term must match somewhere.
 * `extra` lets a caller widen the searchable set (e.g. order code/phone in admin).
 */
export function productSearchWhere(raw: string, fields: SearchableField[] = DEFAULT_FIELDS): Record<string, unknown> | null {
  const ts = terms(raw);
  if (!ts.length) return null;
  const or = (t: string) => {
    const clauses: Record<string, unknown>[] = [];
    for (const f of fields) {
      if (f === "categoryName") clauses.push({ category: { is: { name: ci(t) } } });
      else if (f === "orderCode") clauses.push({ code: ci(t) });
      else clauses.push({ [f]: ci(t) });
    }
    return { OR: clauses };
  };
  return ts.length === 1 ? or(ts[0]) : { AND: ts.map(or) };
}

/**
 * Category-slug compatibility: legacy/typo'd slugs that exist (or existed) in the DB.
 * Keeps old links and the current menu working while admin renames are applied.
 * key = incoming slug, value = canonical slug in the Category table.
 */
export const CATEGORY_ALIASES: Record<string, string> = {
  "straight-fit": "stright-fit",       // correct spelling typed → stored typo
  "stright-fit-pants": "stright-fit",
  "leather-jacket": "lather-jacket",    // correct spelling typed → stored typo
  "jacket": "lather-jacket",
  "jackets": "lather-jacket",
  "flame-patchwork": "falme-patchwork",
  "wide-leg": "wide-leg-t-shirt",
  "t-shirt": "wide-leg-t-shirt",
};

/** Resolve an incoming ?category= value to the real slug (alias-aware). */
export function resolveCategorySlug(raw: string | undefined, knownSlugs: string[]): string | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (knownSlugs.includes(s)) return s;
  const alias = CATEGORY_ALIASES[s];
  if (alias && knownSlugs.includes(alias)) return alias;
  // reverse: someone stored the correct slug but the link still uses the typo
  const back = Object.entries(CATEGORY_ALIASES).find(([, v]) => v === s)?.[0];
  if (back && knownSlugs.includes(back)) return back;
  return null;
}

/** Display tidy-up: DB text has trailing spaces ("LATHER JACKET ") → breaks <title>, JSON-LD, shares. */
export const clean = (s?: string | null): string => String(s || "").replace(/\s+/g, " ").trim();
