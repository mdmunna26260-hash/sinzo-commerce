import PurchaseTracker from "./tracker";
import SuccessReceipt from "./receipt";
import { getSuccessOrder } from "@/lib/success-order";
import { getSettings } from "@/lib/settings";
import { waLink } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Thank You - Order Received",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function SuccessPage(props: {
  searchParams: Promise<{ code?: string; ph?: string; eid?: string; total?: string; ids?: string; num?: string }>;
}) {
  const query = await props.searchParams;
  // Prices, items and payment/status labels come from the verified order, never URL totals.
  const order = await getSuccessOrder(query.code, query.ph);
  const settings = await getSettings();
  const support = settings.store?.whatsapp;
  const supportHref = support ? waLink(String(support)) : undefined;
  const eid = typeof query.eid === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(query.eid) ? query.eid : "";
  return <>
    {order && eid && <PurchaseTracker eid={eid} total={order.total} ids={order.items.filter((item) => item.productId).map((item) => String(item.productId))} num={order.items.reduce((sum, item) => sum + item.qty, 0)} phone={order.phone} />}
    <SuccessReceipt order={order} supportHref={supportHref} />
  </>;
}
