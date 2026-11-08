"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/* Phone verification gate for public invoices (PII protection).
   Only the order phone can view the invoice — same trust model as /track. */
export default function InvoicePhoneForm({ code }: { code: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 10) { setErr("Enter the mobile number used for this order"); return; }
    router.push(`/invoice/${code}?phone=${digits}`);
  };
  return (
    <div className="inv-root" style={{ maxWidth: 420, margin: "60px auto", padding: "0 20px", fontFamily: "Arial, sans-serif", color: "#111", textAlign: "center" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media (prefers-color-scheme: dark) {
          .inv-root, .inv-root * { color: #e9e7e4 !important; }
          .inv-root .inv-card { background: #1e1e20 !important; border-color: #3a3a3a !important; }
          .inv-root .inv-input { background: #141416 !important; border-color: #3a3a3a !important; color: #e9e7e4 !important; }
          .inv-root .inv-input::placeholder { color: #8a8a8a !important; }
          .inv-root .inv-btn { background: #e9e7e4 !important; color: #141414 !important; }
          .inv-root .inv-err { color: #ff8a80 !important; }
        }
      ` }} />
      <div className="brand-wm" style={{ fontSize: 26, letterSpacing: "0.25em", marginBottom: 8 }}>SINZO</div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>Invoice · {code}</div>
      <div className="inv-card" style={{ background: "#faf9f7", border: "1px solid #e5e1da", borderRadius: 10, padding: 24, textAlign: "left" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Verify to view invoice</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
          For your privacy, enter the mobile number you used to place this order.
        </div>
        <input
          type="tel"
          inputMode="numeric"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="inv-input"
          style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 15, border: "1px solid #d5d0c8", borderRadius: 8, marginBottom: 10, background: "#fff", color: "#111" }}
        />
        {err && <div className="inv-err" style={{ color: "#b3392f", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
        <button
          onClick={submit}
          className="inv-btn"
          style={{ width: "100%", padding: "12px 14px", fontSize: 15, fontWeight: 700, background: "#141414", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
        >
          View invoice →
        </button>
      </div>
      <a href="/track" style={{ fontSize: 13, color: "#666", marginTop: 18, display: "inline-block" }}>← Track your order instead</a>
    </div>
  );
}
