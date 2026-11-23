export function successProgress(status: string) {
  if (["CANCELLED", "RETURNED"].includes(status)) return { closed: true, stage: -1, label: status === "CANCELLED" ? "Order cancelled" : "Order returned" };
  if (status === "ON_HOLD") return { closed: true, stage: -1, label: "Order on hold" };
  const stage = status === "DELIVERED" ? 3 : status === "SHIPPED" ? 2 : ["CONFIRMED", "PROCESSING", "PACKED"].includes(status) ? 1 : 0;
  return { closed: false, stage, label: stage === 3 ? "Order delivered" : stage === 2 ? "Order dispatched" : stage === 1 ? "Order confirmed" : "Order received" };
}
