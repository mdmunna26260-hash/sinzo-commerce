import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import OrderDetailClient from "./client";

export const dynamic = "force-dynamic";

export default async function OrderDetail({ params, searchParams }: { params: { id: string }; searchParams: any }) {
  await requireAdmin(searchParams);
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) notFound();
  const data = {
    ...order,
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    attribution: order.attribution ? JSON.parse(order.attribution) : null,
  };
  return <OrderDetailClient initial={data} />;
}
