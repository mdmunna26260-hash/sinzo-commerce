/* Home skeleton — hero band + featured grid (mirrors the real layout) */
export default function Loading() {
  return (
    <div className="container" style={{ paddingTop: 18, paddingBottom: 60 }} aria-busy="true">
      <div className="sk" style={{ height: "min(62vh, 540px)" }} />
      <div style={{ height: 40 }} />
      <div className="sk-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="sk sk-img" />
            <div className="sk sk-line" style={{ width: "72%" }} />
            <div className="sk sk-line sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
