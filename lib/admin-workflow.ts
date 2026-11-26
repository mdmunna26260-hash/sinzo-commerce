/* One definition shared by dashboard counts and the linked Orders queue. */
import type { Prisma } from "@prisma/client";

export const READY_TO_SEND_STATUSES = ["CONFIRMED", "PROCESSING", "PACKED"];
export function readyToSendWhere() {
  return { status: { in: READY_TO_SEND_STATUSES }, OR: [{ courierConsignmentId: null }, { courierConsignmentId: "" }] };
}
export function isReadyToSend(order: { status: string; courierConsignmentId?: string | null }) {
  return READY_TO_SEND_STATUSES.includes(order.status) && !order.courierConsignmentId;
}
export function workflowQueue(tab: string, queue: unknown) {
  if (tab === "READY" && queue === "ready") return { name: "ready to send", where: readyToSendWhere() };
  if (tab === "PENDING" && queue === "pending") return { name: "pending", where: { status: "PENDING" } };
  if (tab === "ON_HOLD" && queue === "hold") return { name: "on-hold", where: { status: "ON_HOLD" } };
  return null;
}

/* Status tab → server-side filter.
   The orders list used to load a fixed window of the newest 200 rows and filter the tabs in
   the BROWSER, so "Delivered" only ever meant "delivered among the newest 200" and an older
   order was unreachable except by typing its code. Tabs are now applied in the query, so the
   pager can walk the whole table. Keep this list in step with the TABS labels in
   app/admin/(panel)/orders/client.tsx. */
export const ORDER_TAB_STATUSES: Record<string, string[]> = {
  ALL: [],
  PENDING: ["PENDING"],
  CONFIRMED: ["CONFIRMED"],
  ACTIVE: ["PROCESSING", "PACKED", "SHIPPED"],
  ON_HOLD: ["ON_HOLD"],
  DELIVERED: ["DELIVERED"],
  CLOSED: ["CANCELLED", "RETURNED"],
};

export function orderTabWhere(tab: string): Prisma.OrderWhereInput {
  if (tab === "READY") return readyToSendWhere();
  if (tab === "PREORDER") return { items: { some: { preorder: true } } };
  const statuses = ORDER_TAB_STATUSES[tab];
  return statuses && statuses.length ? { status: { in: statuses } } : {};
}

/* Count of orders per status tab for the current base filter, used for the tab badges so
   the number on the tab is the number the pager can actually reach. `total` is passed in
   rather than summed from the status groups, so a legacy status that is in no tab still
   shows up in "All". */
export function tabCounts(statusCounts: Record<string, number>, ready: number, preorder: number, total: number): Record<string, number> {
  const out: Record<string, number> = { ALL: total, READY: ready, PREORDER: preorder };
  for (const [tab, statuses] of Object.entries(ORDER_TAB_STATUSES)) {
    if (!statuses.length) continue;
    out[tab] = statuses.reduce((sum, status) => sum + (statusCounts[status] || 0), 0);
  }
  return out;
}
export function adminWorkflowHref(path: string, token?: string) {
  if (!token) return path;
  const url = new URL(path, "https://admin.invalid");
  // Never carry a preview credential to the storefront or an external URL.
  if (url.origin !== "https://admin.invalid" || !url.pathname.startsWith("/admin/")) return path;
  url.searchParams.set("t", token);
  return url.pathname + url.search + url.hash;
}
