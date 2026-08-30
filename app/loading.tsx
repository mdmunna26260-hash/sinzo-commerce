export default function RouteLoading() {
  /* Shown only when a navigation has no cached payload (rare after prefetch).
     Instant branded feedback instead of a frozen old page. */
  return (
    <div style={{ minHeight: "62vh", display: "flex", alignItems: "center", justifyContent: "center" }} aria-live="polite" aria-busy="true">
      <span className="inf-spinner" />
    </div>
  );
}
