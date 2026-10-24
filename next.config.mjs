/** @type {import('next').NextConfig} */
// build: 1788065000
const IS_PROD = process.env.NODE_ENV === "production";

/* ---------------------------------------------------------------------------
 * CSP — Content-Security-Policy
 * The storefront renders inline <script> for the theme bootstrap + JSON-LD, so
 * script-src needs 'unsafe-inline' today (moving those to nonces is a separate
 * refactor). Even so, this policy blocks the practical XSS escalation path:
 * loading an attacker's script from an external host, inline event handlers in
 * injected HTML, <object>/<embed>, form posts to a phisher, and clickjacking.
 *
 * Ship it dark: the header is sent as Content-Security-Policy-Report-Only until
 * you've watched it for a few days in Admin → Tracking, then set CSP_ENFORCE=1.
 * ------------------------------------------------------------------------- */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // product images can be any host (admin pastes a URL) — keep images open, lock the rest
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://www.google-analytics.com https://www.facebook.com https://graph.facebook.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/* Storefront HTML is public and changes a few times a day → it is cacheable for
 * 60s at a CDN/proxy with background refresh. max-age=0 keeps the BROWSER honest
 * (it still revalidates, so a deploy that renames chunks never leaves a visitor
 * on stale HTML → that was the reason for the old blanket no-store).
 * Anything customer-specific or mutating stays no-store. */
const PUBLIC_HTML = "public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate";

const nextConfig = {
  /* Build output directory. Defaults to `.next` (unchanged for Docker/deploys); the sandbox sets
     NEXT_DIST_DIR=.next-prod so the production preview can be built and served WITHOUT touching
     the dev server's `.next`. That separation matters: a prod build and a `next dev` sharing one
     directory corrupt each other's chunk graph (FIX-LOG §14). */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* Arena previews use a port-prefixed sandbox subdomain for both page and HMR origins. */
  allowedDevOrigins: ["*.e2b.app"],
  images: { unoptimized: true },
  poweredByHeader: false,
  experimental: {
    // Client router cache: visited pages are reused from the browser's memory
    // for 30s (dynamic) / 180s (static) → back-navigation (PDP → home) and
    // repeat clicks (cart, track) feel INSTANT, zero server hit.
    // Safe here: data-heavy views (admin lists, cart, checkout) fetch fresh
    // data client-side on mount — only the page shell is cached.
    staleTimes: { dynamic: 30, static: 180 },
  },

  async redirects() {
    return [
      /* One canonical origin. sinzooffcial.com and www.sinzooffcial.com both served
         the identical page (and http:// not on https) → split cookies + duplicate
         content in Google. 308 (not 301) so POST/params are never downgraded. */
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.sinzooffcial.com" }],
        destination: "https://sinzooffcial.com/:path*",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" + (IS_PROD ? "; preload" : "") },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: IS_PROD && process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
            value: CSP,
          },
        ],
      },
      // Images: cache for 1 YEAR (they never change - new uploads get new URLs)
      { source: "/uploads/:path*", headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ]},
      /* Next.js static assets.
         PRODUCTION: the filenames carry a content hash (`app/page-6f8a9c.js`), so a 1-year
         immutable cache is correct and is what the CDN relies on.
         DEVELOPMENT: the filenames are NOT hashed — `app/page.js`, `app-pages-internals.js`,
         `main-app.js`, `not-found-boundary.js` — and their CONTENT changes on every recompile.
         Serving those "immutable, max-age=31536000" (as this rule used to, for every environment)
         meant a browser kept the old build's chunks for a year and never revalidated: after any
         rebuild it ran a mix of old and new chunks, webpack could not resolve a module factory
         ("Cannot read properties of undefined (reading 'call')"), sections disappeared and the
         route fell into the Oops card — and NOTHING could fix it, reloads included, because the
         bad copy was immutable. Measured 2026-09-22 on the dev preview (FIX-LOG §16). */
      IS_PROD
        ? { source: "/_next/static/:path*", headers: [
            { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ]}
        : { source: "/_next/static/:path*", headers: [
            { key: "Cache-Control", value: "no-store, must-revalidate" },
          ]},
      /* Private / mutating surfaces: never cached anywhere.
         Cache-Control is a LIST, not a single value: every matching rule appends its own
         header and the browser obeys the most restrictive one. So this catch-all used to
         shadow the PUBLIC_HTML rules further down and "/" answered "private, no-store"
         even though its own rule said public. Scoping it is what lets the storefront be
         cached at all. */
      { source: "/((?!_next/static|api/media|uploads|products|collections|$).*)", headers: [
        { key: "Cache-Control", value: "private, no-store, must-revalidate" },
      ]},
      { source: "/cart", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/checkout", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/account", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/login", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/register", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/admin", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }] },
      /* Product images must NOT inherit the no-store above. The media route already answers with a
         1-year immutable Cache-Control, but this /api/:path* rule was applied on top of it, so every
         product photo came back "private, no-store" - measured on the live site: 744KB of images on /
         at 390px, re-downloaded on every single page view. Media ids are immutable (a re-upload mints
         a new id), so caching them forever is safe. This rule has to stay AFTER /api/:path*: the last
         matching Cache-Control wins (that is how /products keeps PUBLIC_HTML instead of the no-store). */
      { source: "/api/media/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400" }] },
      /* Storefront catalogue pages: cacheable at the edge, revalidated by the browser.
         (Stock badges can therefore lag up to 60s; the cart/checkout re-checks price
         and stock against the DB, so an oversell can't come from this.) */
      { source: "/", headers: [{ key: "Cache-Control", value: PUBLIC_HTML }] },
      { source: "/products", headers: [{ key: "Cache-Control", value: PUBLIC_HTML }] },
      { source: "/products/:path*", headers: [{ key: "Cache-Control", value: PUBLIC_HTML }] },
      { source: "/collections/:path*", headers: [{ key: "Cache-Control", value: PUBLIC_HTML }] },
    ];
  },
};
export default nextConfig;
