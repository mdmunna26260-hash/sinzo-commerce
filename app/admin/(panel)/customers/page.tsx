import { db } from "@/lib/db";
import CustomersClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const [customers, blacklists] = await Promise.all([
    db.customer.findMany({ include: { orders: { orderBy: { id: "desc" }, take: 15 } }, orderBy: { id: "desc" }, take: 300 }),
    db.blacklist.findMany({ where: { type: { in: ["PHONE", "IP"] } } }),
  ]);
  const blMap: Record<string, number> = {};
  for (const b of blacklists) blMap[`${b.type}:${b.value}`] = b.id;
  const data = customers.map((c) => {
    const delivered = c.orders.filter((o) => !["CANCELLED"].includes(o.status));
    const cancelled = c.orders.filter((o) => ["CANCELLED", "RETURNED"].includes(o.status)).length;
    const spent = delivered.reduce((a, o) => a + o.total, 0);
    let segment = "New";
    if (blMap[`PHONE:${c.phone}`]) segment = "Blocked";
    else if (cancelled >= 3) segment = "Risky";
    else if (spent >= 20000 || c.orders.length >= 8) segment = "VIP";
    else if (c.orders.length >= 2) segment = "Returning";
    return {
      id: c.id, phone: c.phone, name: c.name, email: c.email, address: c.address, area: c.area,
      orders: c.orders.length, spent, cancelled, segment,
      lastOrder: c.orders[0]?.createdAt?.toISOString() || null,
      phoneBlocked: !!blMap[`PHONE:${c.phone}`], phoneBlacklistId: blMap[`PHONE:${c.phone}`] || null,
      history: c.orders.map((o) => ({
        id: o.id, code: o.code, status: o.status, total: o.total, createdAt: o.createdAt.toISOString(),
        courierName: o.courierName, courierConsignmentId: o.courierConsignmentId, courierStatus: o.courierStatus, area: o.area,
      })),
    };
  });
  return <CustomersClient initial={data} />;
}
