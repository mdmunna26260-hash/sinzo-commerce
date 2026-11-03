/* 3-level category tree helpers (main → sub → child).
   Shared by the admin catalog UI, the product form and the storefront nav. */

export type CatLike = { id: number; name: string; slug: string; parentId?: number | null };
type IdParent = { id: number; parentId?: number | null };

export type CatNode<T extends CatLike = CatLike> = T & {
  level: number;          // 1 = main, 2 = sub, 3 = child
  children: CatNode<T>[];
  path: string;           // "Main › Sub › Child"
};

export const MAX_CATEGORY_DEPTH = 3;

/** Build a forest from a flat list; returns roots (level 1) with nested children. */
export function buildCategoryTree<T extends CatLike>(cats: T[]): CatNode<T>[] {
  const byId = new Map<number, CatNode<T>>();
  for (const c of cats) byId.set(c.id, { ...c, level: 1, children: [], path: c.name });
  const roots: CatNode<T>[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId)!;
      node.level = parent.level + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const setPath = (n: CatNode<T>) => {
    n.path = n.level === 1 ? n.name : `${byId.get(n.parentId!)!.path} › ${n.name}`;
    for (const ch of n.children) setPath(ch);
  };
  for (const r of roots) setPath(r);
  const byName = (a: CatNode<T>, b: CatNode<T>) => a.name.localeCompare(b.name);
  const sortRec = (nodes: CatNode<T>[]) => { nodes.sort(byName); for (const n of nodes) sortRec(n.children); };
  sortRec(roots);
  return roots;
}

/** Pre-order flatten of the forest (parents always before their children). */
export function flattenCategoryTree<T extends CatLike>(cats: T[]): CatNode<T>[] {
  const out: CatNode<T>[] = [];
  const walk = (nodes: CatNode<T>[]) => { for (const n of nodes) { out.push(n); walk(n.children); } };
  walk(buildCategoryTree(cats));
  return out;
}

/** Depth of a category given the flat list (1 = main). Unknown parents count as root. */
export function categoryLevel(cats: IdParent[], id: number): number {
  const byId = new Map(cats.map((c) => [c.id, c]));
  let level = 1;
  let cur = byId.get(id);
  const seen = new Set<number>();
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    level++;
    cur = byId.get(cur.parentId);
  }
  return level;
}

/** "Main › Sub › Child" label for a category. */
export function categoryPathLabel(cats: CatLike[], id: number): string {
  const flat = flattenCategoryTree(cats);
  return flat.find((c) => c.id === id)?.path || "";
}

/** Nav/header/pill friendly list: tree-ordered, children indented with "↳ ". */
export function navCats<T extends CatLike>(cats: T[]): { name: string; slug: string }[] {
  return flattenCategoryTree(cats).map((c) => ({
    name: c.level > 1 ? "↳ ".repeat(c.level - 1) + c.name : c.name,
    slug: c.slug,
  }));
}
