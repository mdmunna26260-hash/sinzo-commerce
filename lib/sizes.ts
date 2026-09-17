/* Shared size ordering — extracted from components/parts.tsx so that client islands
   (QuickAdd) can import it without a circular parts.tsx <-> quick-add.tsx import. */

const SIZE_SEQ = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL"];

function sizeRank(s: string): number {
  const u = s.trim().toUpperCase().replace(/^3XL$/, "XXXL");
  const i = SIZE_SEQ.indexOf(u);
  return i === -1 ? 999 : i;
}

/* serial order: numeric ascending first (28, 30, 32…), then S → M → L → XL → XXL → … */
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if (!Number.isNaN(na)) return -1;
    if (!Number.isNaN(nb)) return 1;
    const ra = sizeRank(a), rb = sizeRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}
