import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import OrderDetailClient from "./client";

export const dynamic = "force-dynamic";

export default async function OrderDetail(props: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireAdmin(searchParams, "orders");
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) notFound();
  // neighbour ids (same ordering as the orders list: newest first) for fast prev/next switching
  const all = await db.order.findMany({ select: { id: true, code: true, status: true }, orderBy: { id: "desc" }, take: 500 });
  const idx = all.findIndex((x) => x.id === order.id);
  const nav = {
    prev: idx > 0 ? { id: all[idx - 1].id, code: all[idx - 1].code, status: all[idx - 1].status } : null, // newer
    next: idx >= 0 && idx < all.length - 1 ? { id: all[idx + 1].id, code: all[idx + 1].code, status: all[idx + 1].status } : null, // older
  };
  const data = {
    ...order,
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    attribution: order.attribution ? JSON.parse(order.attribution) : null,
  };
  return <OrderDetailClient initial={data} nav={nav} />;
}
