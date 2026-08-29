/** @type {import('next').NextConfig} */
// build: 1787932717
const nextConfig = {
  images: { unoptimized: true },
  poweredByHeader: false,
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
    ];
  },
};
export default nextConfig;
