import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty" style={{ padding: "150px 24px" }}>
      <div className="eyebrow">Error 404</div>
      <h1 style={{ fontSize: "clamp(40px,6vw,72px)", margin: "10px 0" }}>Page not found</h1>
      <p style={{ color: "var(--muted)" }}>The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <br />
      <Link className="btn" href="/">Back to Home</Link>
    </div>
  );
}
