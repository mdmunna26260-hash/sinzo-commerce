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
    const users = await db.user.findMany({ where: { active: true } });
    const user = users.find((u) => u.email.toLowerCase() === lowerEmail);
    if (!user || !user.active) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    const ok = await bcrypt.compare(String(password || ""), user.password);
    if (!ok) { await logAudit(user.email, "LOGIN_FAILED", undefined, ip); return NextResponse.json({ error: "Invalid email or password" }, { status: 401 }); }
    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    await logAudit(user.email, "LOGIN", undefined, ip);
    const res = NextResponse.json({ ok: true, token, user: { email: user.email, name: user.name, role: user.role } });
    const c = sessionCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
