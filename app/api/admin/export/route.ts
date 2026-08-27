import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
function csv(rows: any[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}
export async function GET(req: Request) {
  const type = new URL(req.url).searchParams.get("type") || "orders";
  const g = await requirePerm(type === "products" ? "products" : "orders");
  if ("res" in g) return g.res;
  let rows: any[][] = [];
  if (type === "orders") {
    const orders = await db.order.findMany({ include: { items: true }, orderBy: { id: "desc" } });
    rows = [["Code", "Date", "Name", "Phone", "Address", "Area", "Items", "Subtotal", "Discount", "Delivery", "Total", "Payment", "Status", "Risk", "Source"]];
    for (const o of orders) rows.push([o.code, o.createdAt.toISOString(), o.name, o.phone, o.address, o.area, o.items.map((i) => `${i.title} x${i.qty}`).join("; "), o.subtotal, o.discount, o.deliveryFee, o.total, o.paymentMethod + "/" + o.paymentStatus, o.status, o.riskLevel, o.source]);
  } else if (type === "products") {
    const ps = await db.product.findMany({ include: { category: true } });
    rows = [["ID", "Title", "SKU", "Category", "Price", "ComparePrice", "Stock", "Status", "Featured", "Views"]];
    for (const p of ps) rows.push([p.id, p.title, p.sku, p.category?.name, p.price, p.comparePrice, p.stock, p.status, p.featured, p.views]);
  } else if (type === "customers") {
    const cs = await db.customer.findMany({ include: { orders: true } });
    rows = [["Phone", "Name", "Email", "Address", "Orders", "TotalSpent", "LastOrder"]];
    for (const c of cs) rows.push([c.phone, c.name, c.email, c.address, c.orders.length, c.orders.reduce((a, o) => a + (o.status !== "CANCELLED" ? o.total : 0), 0), c.orders.sort((a, b) => b.id - a.id)[0]?.createdAt?.toISOString() || ""]);
  } else if (type === "subscribers") {
    const ss = await db.subscriber.findMany({ orderBy: { id: "desc" } });
    rows = [["Email", "Date"]]; for (const x of ss) rows.push([x.email, x.createdAt.toISOString()]);
  } else if (type === "coupons") {
    const cs = await db.coupon.findMany();
    rows = [["Code", "Type", "Value", "Used", "Limit", "Active"]]; for (const c of cs) rows.push([c.code, c.type, c.value, c.usedCount, c.usageLimit, c.active]);
  } else { return new Response("Unknown type", { status: 400 }); }
  return new Response("\ufeff" + csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}-${Date.now()}.csv"` } });
}
