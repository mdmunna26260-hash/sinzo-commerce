/* Route loading state: the classic centered spinner.
   Shown only when a navigation has no cached content (router cache keeps
   this rare) — no artificial delay. */
export default function Loading() {
  return (
    <div style={{ minHeight: "62vh", display: "flex", alignItems: "center", justifyContent: "center" }} aria-live="polite" aria-busy="true">
      <span className="inf-spinner" />
    </div>
  );
}
