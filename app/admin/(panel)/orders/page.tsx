import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { workflowQueue } from "@/lib/admin-workflow";
import OrdersClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

export default async function OrdersPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "orders");
  const tab = typeof searchParams?.tab === "string" && /^[A-Z_]+$/.test(searchParams.tab) ? searchParams.tab : "ALL";
  const queue = workflowQueue(tab, searchParams.queue);
  const orders = await db.order.findMany({ where: queue?.where || {}, include: { items: { include: { product: { select: { images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } } } } } }, orderBy: { id: "desc" }, take: 200 });
  const data = orders.map((o) => ({
    id: o.id, code: o.code, name: o.name, phone: o.phone, address: o.address, area: o.area, total: o.total,
    adminNote: o.adminNote, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
    riskLevel: o.riskLevel, source: o.source, courierName: o.courierName,
    courierConsignmentId: o.courierConsignmentId, courierStatus: o.courierStatus,
    createdAt: o.createdAt.toISOString(), items: o.items.map((i) => ({ title: i.title, qty: i.qty, variant: i.variant, image: i.image || i.product?.images[0]?.url || null, preorder: !!i.preorder })),
  }));
  return <OrdersClient key={tab + ":" + (queue?.name || "all")} initial={data} initialTab={tab} initialQueue={queue?.name || ""} />;
}
