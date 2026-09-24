import { NextResponse } from "next/server";
import { getSettings, envFallback } from "@/lib/settings";
import crypto from "crypto";
export const dynamic = "force-dynamic";

/* The public origin of the storefront.
   Behind Traefik the request's own Host is the container bind address (0.0.0.0:3000), and Google
   rejects that as a redirect URI ("doesn't comply with Google's OAuth 2.0 policy / invalid_request").
   Order of preference: configured site URL → forwarded host → Host header → the known domain. */
function publicBase(req: Request): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = req.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return `${proto}://${host}`;
  return "https://sinzooffcial.com";
}


/* Step 1 of Google (Gmail) login: redirect the customer to Google's consent page.
   Configure Client ID + Secret in Admin → Settings → Integrations first.
   The redirect URI to register in Google Console is exactly:
       https://YOUR-DOMAIN/api/auth/google/callback                                */
export async function GET(req: Request) {
  const s = envFallback(await getSettings());
  const clientId = s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?err=google_not_configured", req.url));
  }
  const origin = publicBase(req);
  const state = crypto.randomBytes(18).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: origin + "/api/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const res = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  res.cookies.set("sz_g_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}
