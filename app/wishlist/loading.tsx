/* Wishlist skeleton */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "38px 24px 100px" }} aria-busy="true">
      <div className="sk sk-line" style={{ width: 150, height: 30 }} />
      <div className="sk-grid" style={{ marginTop: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
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
