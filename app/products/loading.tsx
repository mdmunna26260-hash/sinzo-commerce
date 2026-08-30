/* Products listing skeleton — toolbar lines + product grid */
export default function Loading() {
  return (
    <div className="container shop-wrap" aria-busy="true">
      <div className="sk sk-line" style={{ width: 52 }} />
      <div className="sk sk-line" style={{ width: 210, height: 28 }} />
      <div className="sk sk-line" style={{ width: "72%", maxWidth: 430, marginBottom: 22 }} />
      <div className="sk-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="sk sk-img" />
            <div className="sk sk-line" style={{ width: "70%" }} />
            <div className="sk sk-line sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
