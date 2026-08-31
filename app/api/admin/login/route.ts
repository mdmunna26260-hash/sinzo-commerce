import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createToken, sessionCookie, rateLimit, logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("login:" + ip, 25, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  try {
    const { email, password } = await req.json();
    const lowerEmail = String(email || "").toLowerCase().trim();
    // per-account throttle: 8 failed login posts per email per 15 min → locked out
    if (!rateLimit("login-em:" + lowerEmail, 8, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "This account is temporarily locked. Try again in 15 minutes." }, { status: 429 });
    }
    const passwordStr = String(password || "");
    // look up by exact email (index seek) — never load the whole user table
    const user = await db.user.findFirst({ where: { email: { equals: lowerEmail, mode: "insensitive" }, active: true } });
    // always run a bcrypt compare (dummy hash when user missing) → no user-enumeration timing side channel
    const hash = user?.password || "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBkRG0AmUfyV0JbzhX.T1BxJmWjA1u";
    const ok = await bcrypt.compare(passwordStr, hash);
    if (!user || !user.active || !ok) {
      await logAudit(user?.email || lowerEmail || "unknown", "LOGIN_FAILED", undefined, ip);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    await logAudit(user.email, "LOGIN", undefined, ip);
    const res = NextResponse.json({ ok: true, token, user: { email: user.email, name: user.name, role: user.role } });
    const c = sessionCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
