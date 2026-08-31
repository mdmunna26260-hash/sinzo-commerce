import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
export const dynamic = "force-dynamic";

/* Step 2 of Google (Gmail) login: exchange the code, read the profile,
   find-or-create the customer by email, then set the session cookie.
   New Google accounts get a temporary internal phone id — they can set their
   real mobile number from the Account page (used for order lookup). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = (() => {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(/(?:^|;\s*)sz_g_state=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  const fail = (reason: string) => NextResponse.redirect(new URL("/login?err=" + encodeURIComponent(reason), url.origin));

  try {
    const s = envFallback(await getSettings());
    const clientId = s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = s.integrations?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return fail("google_not_configured");
    if (!code || !state || !stateCookie || state !== stateCookie) return fail("google_state");

    // exchange code → access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: url.origin + "/api/auth/google/callback",
        grant_type: "authorization_code",
      }),
    });
    const token: any = await tokenRes.json();
    if (!token?.access_token) return fail("google_token");

    // profile
    const profRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + token.access_token },
    });
    const prof: any = await profRes.json();
    const email = String(prof?.email || "").toLowerCase().trim();
    if (!email || prof?.email_verified === false) return fail("google_email");

    // find existing customer by email; otherwise create one
    let customer = await db.customer.findFirst({ where: { email } });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          phone: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // temp internal id (replace from Account page)
          name: prof?.name || email.split("@")[0],
          email,
        },
      });
    }

    const tokenJwt = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || customer.email || "Customer" });
    const res = NextResponse.redirect(new URL("/account?welcome=google", url.origin));
    res.cookies.set(customerCookie(tokenJwt) as any);
    res.cookies.set("sz_g_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return fail("google_error");
  }
}
