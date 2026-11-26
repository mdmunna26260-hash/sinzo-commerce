import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* Product ids arrive as an array from the admin form ("123", 123, "" …). Anything that is
   not a positive integer is rejected up front, and ids that do not exist are reported by
   number, because the alternative is a Prisma FK error deep inside a transaction. */
function parseProductIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const value of raw) {
    const id = Number(typeof value === "string" ? value.trim() : value);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    out.push(id);
  }
  return [...new Set(out)];
}

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  if (b.title !== undefined && (typeof b.title !== "string" || !b.title.trim())) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  let productIds: number[] | null = null;
  if (b.productIds !== undefined) {
    productIds = parseProductIds(b.productIds);
    if (!productIds) return NextResponse.json({ error: "productIds must be a list of product ids" }, { status: 400 });
    const known = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true } });
    const knownIds = new Set(known.map((p) => p.id));
    const missing = productIds.filter((pid) => !knownIds.has(pid));
    if (missing.length) return NextResponse.json({ error: `Unknown product id(s): ${missing.slice(0, 10).join(", ")}` }, { status: 400 });
  }

  try {
    /* One transaction. The old code ran deleteMany and then a loop of
       create(...).catch(() => {}) outside one: a failure halfway through left the
       collection EMPTY, and a bad productId was swallowed so the admin saved a
       collection that silently lost rows and still saw "ok". */
    const c = await db.$transaction(async (tx) => {
      const existing = await tx.collection.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return null;
      if (productIds) {
        await tx.collectionProduct.deleteMany({ where: { collectionId: id } });
        if (productIds.length) {
          await tx.collectionProduct.createMany({
            data: productIds.map((productId) => ({ collectionId: id, productId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.collection.update({
        where: { id },
        data: {
          ...(b.title !== undefined ? { title: String(b.title).trim().slice(0, 200) } : {}),
          ...(b.subtitle !== undefined ? { subtitle: b.subtitle ? String(b.subtitle).slice(0, 500) : null } : {}),
          ...(b.image !== undefined ? { image: b.image ? String(b.image).slice(0, 2048) : null } : {}),
        },
      });
    });
    if (!c) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ ok: true, collection: c });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "That collection name/slug is already in use" }, { status: 409 });
    console.error("collection update failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not update the collection" }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  /* Deleting a collection only removes the link rows (CollectionProduct), never products.
     The old `.catch(() => {})` answered {ok:true} even when nothing was deleted, so the
     admin could believe a live collection was gone. */
  const deleted = await db.collection.deleteMany({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Could not delete the collection" }, { status: 500 });
  if (!deleted.count) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
