/* Collection page skeleton */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "38px 24px 100px" }} aria-busy="true">
      <div className="sk sk-line" style={{ width: 100 }} />
      <div className="sk sk-line" style={{ width: 240, height: 30 }} />
      <div className="sk-grid" style={{ marginTop: 26 }}>
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
