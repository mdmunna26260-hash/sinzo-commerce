import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createToken, sessionCookie, rateLimit, logAudit, verifySessionTicket } from "@/lib/auth";
import { verifyTotp, hashRecoveryCode } from "@/lib/totp";
import { getClientIp } from "@/lib/ua";
import { logApp } from "@/lib/logs";

export const dynamic = "force-dynamic";

/* Step 2 of admin login: the 6-digit code from the authenticator app.
   A one-time recovery code is accepted too, and is burned the moment it is used. */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("login2fa:" + ip, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  try {
    const { ticket, code } = await req.json();
    const t = verifySessionTicket(ticket);
    if (!t) return NextResponse.json({ error: "This login attempt expired — sign in again." }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: t.id } });
    if (!user || !user.active || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json({ error: "Two-factor is not available for this account" }, { status: 401 });
    }
    const clean = String(code || "").replace(/\s/g, "");
    let usedRecovery = false;
    let ok = verifyTotp(user.twoFactorSecret, clean);
    if (!ok && user.recoveryCodes) {
      const hashes = user.recoveryCodes.split("\n").filter(Boolean);
      const want = hashRecoveryCode(clean);
      const idx = hashes.findIndex((h) => h.length === want.length && crypto.timingSafeEqual(new TextEncoder().encode(h), new TextEncoder().encode(want)));
      if (idx >= 0) {
        ok = true; usedRecovery = true;
        hashes.splice(idx, 1);
        await db.user.update({ where: { id: user.id }, data: { recoveryCodes: hashes.join("\n") } });
        await logApp("WARN", "WEBHOOK", `2FA: recovery code used by ${user.email} (${hashes.length} left)`, { ip });
      }
    }
    if (!ok) {
      await logAudit(user.email, "LOGIN_2FA_FAILED", undefined, ip);
      return NextResponse.json({ error: "Code is not right (or expired — try the next one)" }, { status: 401 });
    }
    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role, sv: user.sessionVersion });
    await logAudit(user.email, usedRecovery ? "LOGIN_2FA_RECOVERY" : "LOGIN_2FA", undefined, ip);
    const handTokenToJs = process.env.NODE_ENV !== "production" || process.env.AUTH_URL_TOKEN === "1";
    const res = NextResponse.json({ ok: true, ...(handTokenToJs ? { token } : {}), user: { email: user.email, name: user.name, role: user.role }, usedRecovery });
    const c = sessionCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
