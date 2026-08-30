/* Admin skeleton — neutral gray (overrides the storefront skeleton for /admin) */
export default function Loading() {
  return (
    <div style={{ padding: "26px 34px 60px" }} aria-busy="true">
      <div className="sk" style={{ width: 170, height: 22, background: "#e2e0db", borderRadius: 5 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, margin: "20px 0" }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 86, background: "#e2e0db", borderRadius: 6 }} />)}
      </div>
      <div className="sk" style={{ height: 320, background: "#e2e0db", borderRadius: 6 }} />
    </div>
  );
}
