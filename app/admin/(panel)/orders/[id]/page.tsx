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
  const data = {
    ...order,
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    attribution: order.attribution ? JSON.parse(order.attribution) : null,
  };
  return <OrderDetailClient initial={data} />;
}
