import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import ThermalPrintClient from "./thermal-client";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params, searchParams }: { params: { id: string }; searchParams: { t?: string; print?: string } }) {
  await requireAdmin(searchParams);
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) notFound();
  const s = await getSettings();
  const store = s.store || {};

  return <ThermalPrintClient order={{
    id: order.id, code: order.code, name: order.name, phone: order.phone,
    address: order.address, area: order.area, subtotal: order.subtotal,
    discount: order.discount, deliveryFee: order.deliveryFee, total: order.total,
    paymentMethod: order.paymentMethod, courierName: order.courierName,
    courierConsignmentId: order.courierConsignmentId,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((i) => ({ id: i.id, title: i.title, variant: i.variant, price: i.price, qty: i.qty })),
  }} store={{ name: store.name, phone: store.phone }} width={58} />;
}
