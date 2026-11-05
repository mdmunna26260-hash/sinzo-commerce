import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

async function cleanUpdate(body: any) {
  const data: any = {};
  if (body?.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) throw new Error("Title is required");
    data.title = title;
  }
  if (body?.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) throw new Error("Price must be a non-negative number");
    data.price = price;
  }
  if (body?.active !== undefined) data.active = body.active === true;
  if (body?.position !== undefined) data.position = Number.isSafeInteger(Number(body.position)) ? Number(body.position) : 0;
  if (body?.productIds !== undefined) {
    const productIds: number[] = [...new Set<number>((Array.isArray(body.productIds) ? body.productIds : [])
      .map((x: any) => Number(x)).filter((n: number) => Number.isSafeInteger(n) && n > 0))];
    if (productIds.length < 2) throw new Error("A bundle needs at least 2 products");
    if (productIds.length > 20) throw new Error("A bundle can have at most 20 products");
    const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, comboEligible: true } });
    if (products.length !== productIds.length) throw new Error("Some products no longer exist");
    if (products.some((p) => !p.comboEligible)) throw new Error("Only combo-department products (comboEligible) can join a bundle");
    data.items = { deleteMany: {}, create: productIds.map((productId) => ({ productId })) };
  }
  return data;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isSafeInteger(numId) || numId <= 0) return NextResponse.json({ error: "Invalid bundle" }, { status: 400 });
  try {
    const data = await cleanUpdate(await req.json().catch(() => null));
    const bundle = await db.comboBundle.update({
      where: { id: numId }, data,
      include: { items: { include: { product: { select: { id: true, title: true, slug: true, price: true, comboEligible: true } } } } },
    });
    return NextResponse.json({ bundle });
  } catch (e: any) {
    if (e?.code === "P2025") return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    return NextResponse.json({ error: e?.message || "Could not update bundle" }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isSafeInteger(numId) || numId <= 0) return NextResponse.json({ error: "Invalid bundle" }, { status: 400 });
  try {
    await db.comboBundle.delete({ where: { id: numId } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not delete bundle" }, { status: 400 });
  }
}
