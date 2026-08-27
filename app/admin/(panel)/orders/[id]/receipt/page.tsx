import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

export default async function ThermalReceipt({ params, searchParams }: { params: { id: string }; searchParams: { w?: string; t?: string; print?: string } }) {
  await requireAdmin(searchParams);
  const order = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!order) notFound();
  const s = await getSettings();
  const store = s.store || {};
  const merchantId = s.courier?.merchantId || "";
  const w = searchParams.w === "58" ? 58 : 80;
  const t = searchParams.t || "";

  return (
    <div style={{ background: "#f4f3f0", minHeight: "100vh", padding: "14px" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: ${w}mm auto; margin: 2mm; }
        .rc-wrap { max-width: ${w - 6}mm; margin: 0 auto; }
        .rc { background: #fff; color: #000; font-family: "Courier New", ui-monospace, Menlo, monospace; padding: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12); font-size: ${w === 58 ? 10.5 : 12}px; line-height: 1.45; }
        .rc .c { text-align: center; }
        .rc .dash { border-top: 1px dashed #000; margin: 6px 0; }
        .rc table { width: 100%; border-collapse: collapse; }
        .rc td { padding: 1px 0; vertical-align: top; }
        .rc .r { text-align: right; white-space: nowrap; }
        .rc .big { font-size: 1.5em; font-weight: 800; }
        .rc .b { font-weight: 700; }
        .rc .conId { font-size: 1.35em; font-weight: 800; letter-spacing: .02em; word-break: break-all; }
        @media print { .no-print { display: none !important; } .rc { box-shadow: none; } body { background: #fff; } }
      ` }} />
      <div className="rc-wrap">
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <a className="abtn" href={`/admin/orders/${order.id}/receipt?w=58${t ? "&t=" + encodeURIComponent(t) : ""}`}>58mm</a>
          <a className="abtn" href={`/admin/orders/${order.id}/receipt?w=80${t ? "&t=" + encodeURIComponent(t) : ""}`}>80mm</a>
          <button className="abtn primary" id="printbtn">🖨 Print</button>
          <a className="abtn" href={`/admin/orders/${order.id}${t ? "?t=" + encodeURIComponent(t) : ""}`}>← Back</a>
        </div>
        <div className="rc" id="rc">
          <div className="c big" style={{ letterSpacing: ".3em" }}>{store.name || "STORE"}</div>
          {store.phone && <div className="c">{store.phone}</div>}
          <div className="dash" />
          <div><span className="b">{order.code}</span> · {new Date(order.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
          <div className="dash" />
          <div className="b">CUSTOMER</div>
          <div>{order.name}</div>
          <div className="b" style={{ fontSize: "1.2em" }}>{order.phone}</div>
          <div>{order.area === "INSIDE_DHAKA" ? "INSIDE DHAKA" : "OUTSIDE DHAKA"}{order.notes ? ` · ${order.notes}` : ""}</div>
          <div className="dash" />
          <div className="b">ITEMS ({order.items.length})</div>
          <table>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  {i.image && <img src={i.image} alt="" width={30} height={38} style={{ objectFit: "cover", borderRadius: 2, flex: "none", filter: "grayscale(1) contrast(1.05)" }} />}
                  <span>
                    <span className="b">{i.title}</span>
                    {i.variant ? <div style={{ fontSize: ".9em" }}>{i.variant}</div> : null}
                    <div style={{ fontSize: ".9em" }}>{i.qty} × {money(i.price)}</div>
                  </span>
                </td>
                <td className="r b">{money(i.price * i.qty)}</td>
              </tr>
            ))}
          </table>
          <div className="dash" />
          <table>
            <tr><td>Subtotal</td><td className="r">{money(order.subtotal)}</td></tr>
            {order.discount > 0 && <tr><td>Discount {order.couponCode ? `(${order.couponCode})` : ""}</td><td className="r">-{money(order.discount)}</td></tr>}
            <tr><td>Delivery</td><td className="r">{money(order.deliveryFee)}</td></tr>
            <tr><td className="big">TOTAL ({order.paymentMethod})</td><td className="r big">{money(order.total)}</td></tr>
          </table>
          <div className="dash" />
          <div className="c b">{order.paymentMethod === "COD" ? `*** CASH ON DELIVERY — ${money(order.total)} ***` : "*** PAID ***"}</div>
          {order.courierConsignmentId && (
            <>
              <div className="dash" />
              <div>Courier : {order.courierName || "Steadfast"}</div>
              <div>Consignment ID:</div>
              <div className="c conId">{order.courierConsignmentId}</div>
              {merchantId && <div className="c" style={{ fontSize: ".9em", marginTop: 4 }}>MERCHANT ID: {merchantId}</div>}
            </>
          )}
          <div className="dash" />
          <div className="c">Thank you for shopping with us! ♥</div>
          <div className="c" style={{ fontSize: ".85em" }}>{store.phone}</div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        document.getElementById("printbtn")?.addEventListener("click", () => window.print());
        if (new URLSearchParams(location.search).get("print") === "1") setTimeout(() => window.print(), 500);
      ` }} />
    </div>
  );
}
