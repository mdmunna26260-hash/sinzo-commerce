/* One definition shared by dashboard counts and the linked Orders queue. */
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
export function adminWorkflowHref(path: string, token?: string) {
  if (!token) return path;
  const url = new URL(path, "https://admin.invalid");
  // Never carry a preview credential to the storefront or an external URL.
  if (url.origin !== "https://admin.invalid" || !url.pathname.startsWith("/admin/")) return path;
  url.searchParams.set("t", token);
  return url.pathname + url.search + url.hash;
}
