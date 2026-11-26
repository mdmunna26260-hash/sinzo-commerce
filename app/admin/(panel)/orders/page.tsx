import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { workflowQueue, orderTabWhere, tabCounts, readyToSendWhere } from "@/lib/admin-workflow";
import OrdersClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

/* The list used to be a hard `take: 200` with the tab/date/zone/search filters applied in
   the browser. Anything older than the newest 200 orders was invisible — unreachable from
   every tab, and the tab badges only ever described those 200 rows. It is now a real page:
   the tab is part of the query, the pager walks the whole table, and the badges count what
   the pager can reach. */
const PAGE_SIZE = 50;
const MAX_PAGE = 100_000;

export default async function OrdersPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "orders");
  const tab = typeof searchParams?.tab === "string" && /^[A-Z_]+$/.test(searchParams.tab) ? searchParams.tab : "ALL";
  const queue = workflowQueue(tab, searchParams.queue);
  const requestedPage = Number(searchParams?.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, MAX_PAGE) : 1;

  const where = { ...(queue?.where || {}), ...orderTabWhere(tab) };

  const [orders, total, statusRows, readyCount, preorderCount] = await Promise.all([
    db.order.findMany({
      where,
      include: { items: { include: { product: { select: { images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } } } } } },
      orderBy: { id: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.order.count({ where: { ...where, ...readyToSendWhere() } }),
    db.order.count({ where: { ...where, items: { some: { preorder: true } } } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) statusCounts[row.status] = row._count._all;
  const counts = tabCounts(statusCounts, readyCount, preorderCount, total);

  const data = orders.map((o) => ({
    id: o.id, code: o.code, name: o.name, phone: o.phone, address: o.address, area: o.area, total: o.total,
    adminNote: o.adminNote, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
    riskLevel: o.riskLevel, source: o.source, courierName: o.courierName,
    courierConsignmentId: o.courierConsignmentId, courierStatus: o.courierStatus,
    createdAt: o.createdAt.toISOString(), items: o.items.map((i) => ({ title: i.title, qty: i.qty, variant: i.variant, image: i.image || i.product?.images[0]?.url || null, preorder: !!i.preorder })),
  }));

  return (
    <OrdersClient
      /* No `page` in the key on purpose: paging must not remount the client, or the
         admin's search/payment/date filters would silently clear between pages. */
      key={tab + ":" + (queue?.name || "all")}
      initial={data}
      initialTab={tab}
      initialQueue={queue?.name || ""}
      page={page}
      pages={pages}
      total={total}
      counts={counts}
      pageSize={PAGE_SIZE}
    />
  );
}
