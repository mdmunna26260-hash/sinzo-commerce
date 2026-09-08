import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import OrdersClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: any }) {
  await requireAdmin(searchParams);
  const orders = await db.order.findMany({ include: { items: true }, orderBy: { id: "desc" }, take: 200 });
  const data = orders.map((o) => ({
    id: o.id, code: o.code, name: o.name, phone: o.phone, address: o.address, area: o.area, total: o.total,
    status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
    riskLevel: o.riskLevel, source: o.source, courierName: o.courierName,
    courierConsignmentId: o.courierConsignmentId, courierStatus: o.courierStatus,
    createdAt: o.createdAt.toISOString(), items: o.items.map((i) => ({ title: i.title, qty: i.qty, variant: i.variant })),
  }));
  return <OrdersClient initial={data} />;
}
