import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
const ROLES = ["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "PRODUCT_MANAGER", "MARKETING", "SUPPORT"];
export async function GET(req: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ users: await db.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, createdAt: true }, orderBy: { id: "asc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.email || !b.password || !ROLES.includes(b.role)) return NextResponse.json({ error: "Email, password and valid role required" }, { status: 400 });
  try {
    const u = await db.user.create({ data: { email: String(b.email).toLowerCase().trim(), password: await bcrypt.hash(b.password, 10), name: b.name || b.email, role: b.role } });
    await logAudit(g.user.email, "USER_CREATED", u.email);
    return NextResponse.json({ ok: true, user: { id: u.id, email: u.email } });
  } catch { return NextResponse.json({ error: "Email already exists" }, { status: 400 }); }
}
