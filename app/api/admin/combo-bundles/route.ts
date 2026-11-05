import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { normalizeBundles } from "@/lib/combo";

export const dynamic = "force-dynamic";

/* Admin CRUD for cross-product combo bundles. A bundle = fixed price for ONE unit of
   every listed product (extra units stay at base price). Only products flagged
   comboEligible ("combo department") may join a bundle — enforced here server-side. */

function cleanBundleInput(body: any) {
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) throw new Error("Title is required");
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) throw new Error("Price must be a non-negative number");
  const productIds: number[] = [...new Set<number>((Array.isArray(body?.productIds) ? body.productIds : [])
    .map((x: any) => Number(x)).filter((n: number) => Number.isSafeInteger(n) && n > 0))];
  if (productIds.length < 2) throw new Error("A bundle needs at least 2 products");
  if (productIds.length > 20) throw new Error("A bundle can have at most 20 products");
  return { title, price, productIds, active: body?.active !== false, position: Number.isSafeInteger(Number(body?.position)) ? Number(body.position) : 0 };
}

export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const bundles = await db.comboBundle.findMany({ orderBy: { position: "asc" }, include: { items: { include: { product: { select: { id: true, title: true, slug: true, price: true, comboEligible: true } } } } } });
  return NextResponse.json({ bundles });
}

export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const input = cleanBundleInput(await req.json().catch(() => null));
    const products = await db.product.findMany({ where: { id: { in: input.productIds } }, select: { id: true, comboEligible: true } });
    if (products.length !== input.productIds.length) return NextResponse.json({ error: "Some products no longer exist" }, { status: 400 });
    const notEligible = products.filter((p) => !p.comboEligible).map((p) => p.id);
    if (notEligible.length) return NextResponse.json({ error: "Only combo-department products (comboEligible) can join a bundle", notEligible }, { status: 400 });
    const bundle = await db.comboBundle.create({
      data: { title: input.title, price: input.price, active: input.active, position: input.position, items: { create: input.productIds.map((productId) => ({ productId })) } },
      include: { items: { include: { product: { select: { id: true, title: true, slug: true, price: true, comboEligible: true } } } } },
    });
    return NextResponse.json({ bundle });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not create bundle" }, { status: 400 });
  }
}
