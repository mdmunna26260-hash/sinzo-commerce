import type { Metadata, Viewport } from "next";
import "./globals.css";
import RevealInit from "@/components/reveal";
import PageViewTracker from "@/components/pageview";
import PageTransition from "@/components/page-transition";
import { CartProvider } from "@/components/store";
import BottomNav from "@/components/bottom-nav";
import PushRegister from "@/components/push-register";
import PushNudge from "@/components/push-nudge";
import { getSettings, publicSettings } from "@/lib/settings";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#faf9f7",
};

/* Share images: use the 1200px variant instead of the full-res original */
const ogImage = (u?: string) => {
  const m = /^\/api\/media\/([a-z0-9]+)$/i.exec(u || "");
  return m ? `/api/media/${m[1]}/w1200` : u;
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const s = publicSettings(await getSettings());
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "";
    return {
      metadataBase: siteUrl ? new URL(siteUrl.startsWith("http") ? siteUrl : "https://" + siteUrl) : undefined,
      title: { default: s.seo?.metaTitle || s.store?.name || "Store", template: `%s · ${s.store?.name || "Store"}` },
      description: s.seo?.metaDescription || s.store?.tagline || "",
      openGraph: { title: s.seo?.metaTitle || s.store?.name, description: s.seo?.metaDescription, images: s.homepage?.heroImage ? [ogImage(s.homepage.heroImage)] : [] },
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
        <head>
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{var m=localStorage.getItem("sz_theme")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();` }} />
          <style dangerouslySetInnerHTML={{ __html: `:root{--bg:${theme.bg || "#faf9f7"};--text:${theme.text || "#141414"};}` }} />
        </head>
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
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var m=localStorage.getItem("sz_theme")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();` }} />
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
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var k="sz_chunk_err";if(sessionStorage.getItem(k))return;var r=function(m){try{sessionStorage.setItem(k,"1");fetch("/api/client-error",{method:"POST",headers:{"Content-Type":"application/json"},keepalive:true,body:JSON.stringify({message:m,url:location.pathname+location.search})}).catch(function(){});}catch(e){}setTimeout(function(){try{var u=new URL(location.href);if(!u.searchParams.has("_r")){u.searchParams.set("_r",String(Date.now()));location.replace(u.toString());return;}}catch(e){}location.reload();},50);};
window.addEventListener("error",function(e){var s=e&&e.target&&e.target.src||"";if(s&&s.indexOf("/_next/")>-1)r("chunk load fail: "+s.split("/").pop());},true);
window.addEventListener("unhandledrejection",function(e){var m=String(e&&e.reason&&e.reason.message||e&&e.reason||"");if(m.indexOf("dynamically imported module")>-1||m.indexOf("Loading chunk")>-1||m.indexOf("ChunkLoadError")>-1)r("chunk reject: "+m.slice(0,200));});}catch(e){}})();` }} />
        <CartProvider>
        {children}
        <BottomNav />
        </CartProvider>
        <PushRegister />
        <PushNudge />
        <RevealInit />
        <PageViewTracker />
        <PageTransition />
        <script dangerouslySetInnerHTML={{ __html: `history.scrollRestoration = 'manual';` }} />
      </body>
    </html>
  );
}
