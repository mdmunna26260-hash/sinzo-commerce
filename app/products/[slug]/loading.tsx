/* PDP skeleton — breadcrumb + gallery/info two-column (matches real PDP) */
export default function Loading() {
  return (
    <div className="container" aria-busy="true">
      <div style={{ padding: "22px 0 0" }}>
        <div className="sk sk-line" style={{ width: 230 }} />
      </div>
      <div className="pdp-sk" style={{ padding: "24px 0 60px" }}>
        <div className="sk sk-img" />
        <div>
          <div className="sk sk-line sm" style={{ width: 90 }} />
          <div className="sk sk-line" style={{ width: "78%", height: 26, marginTop: 14 }} />
          <div className="sk sk-line" style={{ width: "46%", height: 26 }} />
          <div className="sk sk-line" style={{ width: "88%", marginTop: 16 }} />
          <div className="sk sk-line sm" />
          <div style={{ display: "flex", gap: 10, margin: "18px 0 4px" }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ width: 52, height: 44 }} />)}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
            <div className="sk sk-btn" style={{ flex: 1 }} />
            <div className="sk sk-btn" style={{ flex: 1 }} />
          </div>
          <div className="sk sk-line sm" style={{ width: "62%", marginTop: 22 }} />
          <div className="sk sk-line sm" style={{ width: "48%" }} />
        </div>
      </div>
    </div>
  );
}
