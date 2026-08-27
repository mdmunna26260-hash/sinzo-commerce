export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9\u0980-\u09FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item-" + Date.now().toString(36);
}
export function orderCode(id: number): string {
  return "ORD-" + (1000 + id);
}
export function parseOrderCode(code: string): number | null {
  const m = /^ORD-(\d+)$/i.exec((code || "").trim());
  return m ? parseInt(m[1], 10) - 1000 : null;
}
