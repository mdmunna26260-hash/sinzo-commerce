type WhatsAppOrder = {
  code: string;
  status: string;
  items: { title: string; qty: number; variant?: string | null }[];
};

/* Draft only: opening wa.me never confirms an order or automatically sends it. */
export function orderWhatsAppMessage(order: WhatsAppOrder): string {
  const items = order.items.map((item) => `${item.title}${item.variant ? " (" + item.variant + ")" : ""} x${item.qty}`).join(", ") || "product";
  const statusText: Record<string, string> = {
    PENDING: "receive kora hoyeche. Confirmation-er jonno apnar sathe jogajog korchi.",
    CONFIRMED: "confirmed kora hoyeche.",
    PROCESSING: "process kora hocche.",
    PACKED: "pack kora hoyeche.",
    SHIPPED: "courier-e pathano hoyeche.",
    DELIVERED: "delivered hoyeche.",
    CANCELLED: "cancel kora hoyeche.",
    RETURNED: "return hoyeche.",
    ON_HOLD: "apatoto hold-e ache.",
  };
  return `Assalamu alaikum bhaiya,\n\nApnar "${items}" order ta ${statusText[order.status] || "niye jogajog korchi."}\nOrder ID: ${order.code}\n\nSINZO-er sathe thakar jonno dhonnobad.`;
}
