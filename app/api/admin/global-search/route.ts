import { NextResponse } from "next/server";
import { ci } from "@/lib/search";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";

/* Global admin search: orders (code / name / phone) + products (title / slug).
   Powers the sidebar search box. */
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ orders: [], products: [] });
  const like = ci(q); // mode:"insensitive" is Postgres-only — ci() picks per connector
  // digits only: q="rahim" used to strip to "" and `phone: { contains: "" }` matches
  // EVERY row, so any word-search in the admin box dumped the recent orders
  const digits = q.replace(/[^0-9]/g, "");
  const orderOr: any[] = [{ code: like }, { name: like }];
  if (digits.length >= 3) orderOr.push({ phone: { contains: digits } });
  const [orders, products] = await Promise.all([
    db.order.findMany({
      where: { OR: orderOr },
      select: { id: true, code: true, name: true, phone: true, status: true, total: true, createdAt: true },
      orderBy: { id: "desc" },
      take: 5,
    }),
    db.product.findMany({
      where: { OR: [{ title: like }, { slug: like }] },
      select: { id: true, title: true, slug: true, price: true, stock: true },
      take: 5,
    }),
  ]);
  return NextResponse.json({ orders, products });
}
