/** @type {import('next').NextConfig} */
// build: 1788065000
const nextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
  experimental: {
    // Client router cache: visited pages are reused from the browser's memory
    // for 30s (dynamic) / 180s (static) → back-navigation (PDP → home) and
    // repeat clicks (cart, track, wishlist) feel INSTANT, zero server hit.
    // Safe here: data-heavy views (admin lists, cart, checkout) fetch fresh
    // data client-side on mount — only the page shell is cached.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ]},
      // Images: cache for 1 YEAR (they never change - new uploads get new URLs)
      { source: "/uploads/:path*", headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ]},
      // Next.js static assets: cache for 1 year (hashed filenames)
      { source: "/_next/static/:path*", headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ]},
      // Admin panel: NEVER cached — after every deploy the browser must fetch
      // fresh HTML (stale old HTML references deleted chunks → client crash)
      { source: "/admin/:path*", headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
      ]},
      { source: "/admin", headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
      ]},
      // Products page: short cache + stale-while-revalidate
      { source: "/products", headers: [
        { key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=60" },
      ]},
    ];
  },
};
export default nextConfig;
