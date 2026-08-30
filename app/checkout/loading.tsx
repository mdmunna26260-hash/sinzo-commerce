/* Checkout skeleton — form fields + order summary */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "34px 24px 80px" }} aria-busy="true">
      <div className="sk sk-line" style={{ width: 130 }} />
      <div className="sk sk-line" style={{ width: 200, height: 28 }} />
      <div className="checkout-layout" style={{ marginTop: 18 }}>
        <div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div className="sk sk-line sm" style={{ width: 90 }} />
              <div className="sk" style={{ height: 46 }} />
            </div>
          ))}
        </div>
        <div className="sk" style={{ height: 360 }} />
      </div>
    </div>
  );
}
