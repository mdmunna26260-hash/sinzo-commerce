import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

export default async function Invoice({ params, searchParams }: { params: { id: string }; searchParams: any }) {
  await requireAdmin(searchParams);
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) notFound();
  const s = await getSettings();
  const store = s.store || {};
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, sans-serif", color: "#111" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 18 }}>
        <div>
          <div style={{ fontSize: 26, letterSpacing: "0.25em", fontWeight: 700 }}>{store.name}</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>{store.address}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{store.phone} · {store.email}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>INVOICE</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{order.code}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{new Date(order.createdAt).toLocaleDateString("en-GB")}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "22px 0", gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#777", marginBottom: 6 }}>BILL TO</div>
          <div style={{ fontWeight: 700 }}>{order.name}</div>
          <div style={{ fontSize: 13 }}>{order.phone}</div>
          <div style={{ fontSize: 13, maxWidth: 320 }}>{order.address}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{order.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div>Payment: <b>{order.paymentMethod}</b> ({order.paymentStatus})</div>
          <div>Status: <b>{order.status}</b></div>
          {order.courierConsignmentId && <div>Consignment: {order.courierConsignmentId}</div>}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #111" }}>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Item</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Variant</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Price</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "9px 6px" }}>{i.title}</td>
              <td style={{ padding: "9px 6px", color: "#555" }}>{i.variant || "—"}</td>
              <td style={{ textAlign: "right", padding: "9px 6px" }}>{money(i.price)}</td>
              <td style={{ textAlign: "right", padding: "9px 6px" }}>{i.qty}</td>
              <td style={{ textAlign: "right", padding: "9px 6px" }}>{money(i.price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ width: 280, marginLeft: "auto", marginTop: 16, fontSize: 13.5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Subtotal</span><span>{money(order.subtotal)}</span></div>
        {order.discount > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Discount {order.couponCode ? `(${order.couponCode})` : ""}</span><span>−{money(order.discount)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Delivery</span><span>{money(order.deliveryFee)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "2px solid #111", fontWeight: 700, fontSize: 15 }}><span>TOTAL</span><span>{money(order.total)}</span></div>
      </div>
      <div style={{ marginTop: 40, fontSize: 12, color: "#555", textAlign: "center", borderTop: "1px solid #ddd", paddingTop: 16 }}>
        Thank you for shopping with {store.name}! · {store.phone} · Returns accepted within 7 days
      </div>
      <script dangerouslySetInnerHTML={{ __html: "setTimeout(()=>window.print(),350)" }} />
    </div>
  );
}
