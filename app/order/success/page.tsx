import Link from "next/link";
import PurchaseTracker from "./tracker";
import PushOptIn from "@/components/push-optin";

export const metadata = { title: "Order Confirmed" };

export default function SuccessPage({ searchParams }: { searchParams: { code?: string; total?: string; eid?: string; ids?: string; num?: string; ph?: string } }) {
  const code = searchParams.code || "";
  const total = searchParams.total || "";
  const eid = searchParams.eid || "";
  const ids = (searchParams.ids || "").split(",").filter(Boolean);
  const num = parseInt(searchParams.num || "0", 10) || 0;
  const ph = searchParams.ph || "";
  return (
    <div className="success-wrap">
      {eid && <PurchaseTracker eid={eid} total={Number(total) || 0} ids={ids} num={num} />}
      <div className="check">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <h1>Thank you! Order confirmed.</h1>
      <p style={{ color: "var(--muted)" }}>We&apos;ve received your order. Our team will call you shortly to confirm.</p>
      {code && <div className="order-code">ORDER&nbsp;&nbsp;{code}</div>}
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        {total && <>Amount payable on delivery: <b style={{ color: "var(--text)" }}>৳{Number(total).toLocaleString("en-IN")}</b><br /></>}
        Save your order code to track your parcel anytime.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 26, flexWrap: "wrap" }}>
        {code && (
          <a className="btn btn-accent" href={"/invoice/" + code} target="_blank" rel="noreferrer">
            🧾 Download Invoice
          </a>
        )}
        <Link className="btn" href={"/track?code=" + code}>Track Order</Link>
        <Link className="btn btn-outline" href="/products">Continue Shopping</Link>
      </div>
      <div style={{ maxWidth: 420, margin: "22px auto 0" }}>
        <PushOptIn phone={ph} code={code} />
      </div>
    </div>
  );
}
