import type { Metadata, Viewport } from "next";
import "./globals.css";
import RevealInit from "@/components/reveal";
import PageViewTracker from "@/components/pageview";
import PageTransition from "@/components/page-transition";
import { CartProvider } from "@/components/store";
import BottomNav from "@/components/bottom-nav";
import { getSettings, publicSettings } from "@/lib/settings";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#faf9f7",
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const s = publicSettings(await getSettings());
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "";
    return {
      metadataBase: siteUrl ? new URL(siteUrl.startsWith("http") ? siteUrl : "https://" + siteUrl) : undefined,
      title: { default: s.seo?.metaTitle || s.store?.name || "Store", template: `%s · ${s.store?.name || "Store"}` },
      description: s.seo?.metaDescription || s.store?.tagline || "",
      openGraph: { title: s.seo?.metaTitle || s.store?.name, description: s.seo?.metaDescription, images: s.homepage?.heroImage ? [s.homepage.heroImage] : [] },
    };
  } catch { return { title: "Store" }; }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let cfg: any = null;
  try { cfg = publicSettings(await getSettings()); } catch {}
  const theme = cfg?.theme || {};
  // Maintenance mode: block storefront for non-admins (admins keep full access)
  let adminBypass = false;
  try {
    const { getSessionUser } = await import("@/lib/auth");
    adminBypass = !!(await getSessionUser());
  } catch {}
  if (cfg?.maintenance?.enabled && !adminBypass) {
    const store = cfg.store || {};
    return (
      <html lang="en">
        <head><style dangerouslySetInnerHTML={{ __html: `:root{--bg:${theme.bg || "#faf9f7"};--text:${theme.text || "#141414"};}` }} /></head>
        <body>
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "var(--bg)", color: "var(--text)" }}>
            <div className="logo" style={{ fontSize: 30, letterSpacing: "0.3em" }}>{store.name || "STORE"}</div>
            <h1 style={{ fontFamily: "var(--font-head)", fontSize: 32, margin: "30px 0 10px" }}>We&apos;re doing a little maintenance.</h1>
            <p style={{ color: "#6f6a63", maxWidth: 420 }}>{cfg.maintenance.message || "We'll be back soon."}</p>
            {store.facebook && <a href={store.facebook} style={{ marginTop: 18, borderBottom: "1px solid" }}>Follow us for updates</a>}
          </div>
        </body>
      </html>
    );
  }
  const cssVars = `
    :root {
      ${theme.bg ? `--bg:${theme.bg};` : ""}
      ${theme.text ? `--text:${theme.text};` : ""}
      ${theme.accent ? `--accent:${theme.accent};` : ""}
      ${theme.headingFont ? `--font-head:${theme.headingFont};` : ""}
      ${theme.bodyFont ? `--font-body:${theme.bodyFont};` : ""}
      ${theme.radius != null ? `--radius:${theme.radius}px;` : ""}
      ${theme.productImageRatio ? `--img-ratio:${String(theme.productImageRatio).replace(":", " / ")};` : "--img-ratio:3 / 4;"}
      ${theme.containerWidth ? `--container:${theme.containerWidth}px;` : ""}
    }`;
  const gtmId = cfg?.integrations?.gtmId || "";
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {gtmId ? (
          <script id="gtm" dangerouslySetInnerHTML={{ __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');` }} />
        ) : null}
        <script id="sz-cfg" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(cfg || {}) }} />
      </head>
      <body>
        <CartProvider>
        {children}
        <BottomNav />
        </CartProvider>
        <RevealInit />
        <PageViewTracker />
        <PageTransition />
        <script dangerouslySetInnerHTML={{ __html: `history.scrollRestoration = 'manual';` }} />
      </body>
    </html>
  );
}
