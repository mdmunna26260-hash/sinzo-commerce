/* Track order skeleton — narrow centered panel */
export default function Loading() {
  return (
    <div className="container" aria-busy="true">
      <div className="track-wrap">
        <div className="sk sk-line" style={{ width: 160, height: 24 }} />
        <div className="sk sk-line sm" style={{ width: "70%" }} />
        <div className="sk sk-btn" style={{ marginTop: 26 }} />
        <div className="sk" style={{ height: 170, marginTop: 26 }} />
      </div>
    </div>
  );
}
