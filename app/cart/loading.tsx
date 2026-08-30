/* Cart skeleton — item rows + summary panel */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "34px 24px 80px" }} aria-busy="true">
      <div className="sk sk-line" style={{ width: 120 }} />
      <div className="sk sk-line" style={{ width: 170, height: 28 }} />
      <div className="cart-layout" style={{ marginTop: 18 }}>
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 18, padding: "18px 0", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
              <div className="sk" style={{ height: 126 }} />
              <div>
                <div className="sk sk-line" style={{ width: "55%" }} />
                <div className="sk sk-line sm" />
                <div className="sk sk-line" style={{ width: 90 }} />
                <div className="sk sk-btn" style={{ width: 130 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="sk" style={{ height: 330 }} />
      </div>
    </div>
  );
}
