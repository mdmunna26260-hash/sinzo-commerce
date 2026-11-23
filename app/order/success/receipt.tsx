"use client";
import Link from "next/link";
import { useState } from "react";
import PushOptIn from "@/components/push-optin";
import type { SuccessOrder } from "@/lib/success-order";
import { successProgress } from "@/lib/success-progress";

const money = (amount: number) => "BDT " + amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const Check = () => <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;

export default function SuccessReceipt({ order, supportHref }: { order: SuccessOrder | null; supportHref?: string }) {
  const [copyNotice, setCopyNotice] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const progress = successProgress(order?.status || "PENDING");
  const copyCode = async () => {
    if (!order) return;
    let copied = false;
    try { await navigator.clipboard.writeText(order.code); copied = true; } catch {
      const input = document.createElement("textarea");
      input.value = order.code; input.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(input); input.select();
      try { copied = document.execCommand("copy"); } catch {} finally { input.remove(); }
    }
    setCopyNotice(copied ? "Order code copied." : "Copy unavailable. Please save the order code shown above.");
  };
  const zone = order?.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka";
  const paymentMethod = order?.paymentMethod === "COD" ? "Cash on Delivery" : order?.paymentMethod;
  const quantity = order?.items.reduce((sum, item) => sum + item.qty, 0) || 0;
  const amountLabel = progress.closed ? "Order total" : order?.paymentStatus === "PAID" ? "Paid in full" : order?.paymentStatus === "REFUNDED" ? "Payment refunded - check tracking" : order?.paymentStatus === "FAILED" ? "Payment not completed" : order?.balance === null ? "Order total - advance recorded" : order?.paymentMethod === "COD" ? "Amount payable on delivery" : "Payment awaiting verification";
  return (
    <div className="receipt-page">
      <header className="receipt-header">
        <Link href="/products" aria-label="Back to store"><span aria-hidden="true">&larr;</span> Store</Link>
        <Link href="/" className="brand-wm" aria-label="SINZO home">SINZO</Link>
        <span>{order ? order.code : "Thank you"}</span>
      </header>
      <main className="receipt-main">
        <section className="receipt-hero">
          {order && !progress.closed && <div className="receipt-check"><Check /></div>}
          <p className="receipt-eyebrow">{order ? progress.label : "Your order details"}</p>
          <h1>{order ? progress.closed ? progress.label : <>Thank you for<br />your order.</> : "Find your order."}</h1>
          <p>{!order ? "Open the link from checkout, or use Track Order with your order code and mobile number to view your details securely."
            : progress.closed ? "Please check tracking for the latest details, or contact our team if you need help."
            : progress.stage === 0 ? <>We have received your order. Our team will contact you on <strong>{order.phone}</strong> to confirm the details.</>
            : progress.stage === 3 ? "Your order is marked as delivered. Thank you for shopping with SINZO."
            : progress.stage === 2 ? "Your order is marked as dispatched. Open tracking for the latest parcel updates."
            : "Your order has been confirmed. We will update tracking when your parcel is dispatched."}</p>
        </section>
        {order && <div className="receipt-grid">
          <div className="receipt-overview">
            <section className="receipt-card receipt-reference" aria-label="Order reference">
              <div className="receipt-code-row">
                <div><span className="receipt-label">Order reference</span><strong>{order.code}</strong></div>
                <button type="button" onClick={copyCode} aria-label="Copy order code"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy</button>
              </div>
              <div className="receipt-payable"><span>{amountLabel}</span><b>{money(progress.closed || order.paymentStatus === "REFUNDED" || order.balance === null ? order.total : order.paymentStatus === "PAID" ? order.total : order.balance)}</b></div>
              <p>Save your order code to track your parcel anytime.</p>
              <span className="receipt-copy-notice" role="status">{copyNotice}</span>
            </section>
            {!progress.closed && <section className="receipt-card receipt-progress" aria-label="Order progress">
              <ol>{["Order placed", "Confirmation", "Courier dispatch"].map((label, index) => {
                const done = index <= progress.stage;
                return <li key={label} className={done ? "is-done" : index === progress.stage + 1 ? "is-next" : ""} aria-current={index === progress.stage ? "step" : undefined}>
                  <span className="receipt-step-icon">{done ? <Check /> : index + 1}</span>
                  <b>{label}</b><small>{done ? "Done" : index === progress.stage + 1 ? "Up next" : "After confirmation"}</small>
                </li>;
              })}</ol>
            </section>}
            <div className="receipt-actions">
              <Link className="receipt-action" href={"/track?code=" + encodeURIComponent(order.code)}>Track order <span aria-hidden="true">&rarr;</span></Link>
              <a className="receipt-action receipt-action-bronze" href={"/invoice/" + encodeURIComponent(order.code)} target="_blank" rel="noopener noreferrer">View invoice / Save PDF</a>
              <Link className="receipt-action receipt-action-outline" href="/products">Continue shopping</Link>
              <p className="receipt-secure-note">Tracking and invoices may ask for your order phone number.</p>
            </div>
          </div>
          <section className="receipt-card receipt-summary">
            <button className="receipt-summary-toggle" type="button" aria-expanded={summaryOpen} aria-controls="receipt-summary-body" onClick={() => setSummaryOpen(!summaryOpen)}>
              <span>Order summary <small>{quantity} {quantity === 1 ? "item" : "items"}</small></span><span>{summaryOpen ? "Hide" : "Show"} <span aria-hidden="true">{summaryOpen ? "-" : "+"}</span></span>
            </button>
            <div className="receipt-summary-body" id="receipt-summary-body" hidden={!summaryOpen}>
              <ul className="receipt-items">{order.items.map((item, index) => <li key={index}>
                <div className="receipt-thumb" aria-hidden="true">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z" /></svg>
                  {item.image && <img src={/^\/api\/media\/[^/]+$/.test(item.image) ? item.image + "/w160" : item.image} alt="" width="56" height="64" onError={(event) => { event.currentTarget.hidden = true; }} />}
                </div>
                <div className="receipt-item-detail"><h2>{item.title}</h2><p>{item.variant && <span>{item.variant}</span>} Qty: {item.qty}</p>{item.preorder && <small className="receipt-preorder">Pre-order</small>}</div>
                <b>{money(item.price * item.qty)}</b>
              </li>)}</ul>
              <div className="receipt-zone"><span>Delivery zone</span><strong>{zone}</strong></div>
              <dl className="receipt-totals">
                <div><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
                {order.discount > 0 && <div><dt>Discount</dt><dd>-{money(order.discount)}</dd></div>}
                <div><dt>Delivery charge</dt><dd>{money(order.deliveryFee)}</dd></div>
                <div className="receipt-grand-total"><dt>Order total</dt><dd>{money(order.total)}</dd></div>
              </dl>
              <p className="receipt-payment-method">{paymentMethod} / {order.paymentStatus.replace(/_/g, " ")}</p>
            </div>
          </section>
        </div>}
        {!order && <div className="receipt-actions receipt-fallback"><Link className="receipt-action" href="/track">Track order</Link><Link className="receipt-action receipt-action-outline" href="/products">Continue shopping</Link></div>}
        {supportHref && supportHref !== "#" && <footer className="receipt-support"><a href={supportHref + (order ? "?text=" + encodeURIComponent("Hello SINZO, I need help with size or address for order " + order.code + ".") : "")} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Need help with size or address? <strong>Chat on WhatsApp</strong></a></footer>}
        {order && <div className="receipt-push"><PushOptIn phone={order.phone} code={order.code} /></div>}
      </main>
    </div>
  );
}
