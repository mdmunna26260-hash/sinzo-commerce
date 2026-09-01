import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
const ROLES = ["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "PRODUCT_MANAGER", "MARKETING", "SUPPORT"];

/* SECURITY: user/role management is SUPER_ADMIN-only, enforced SERVER-SIDE.
   The session token's role is not trusted — the acting user's role is re-read
   from the database on every mutation. ADMIN (and every other role) may VIEW
   the team list but can never create users or change roles/status/passwords. */
async function requireSuperAdmin(req?: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g;
  const dbUser = await db.user.findUnique({ where: { id: g.user.id }, select: { role: true, active: true } });
  if (!dbUser?.active || dbUser.role !== "SUPER_ADMIN") {
    return { res: NextResponse.json({ error: "You do not have permission to manage team members." }, { status: 403 }) };
  }
  return { user: g.user };
}

export async function GET(req: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ users: await db.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, createdAt: true }, orderBy: { id: "asc" } }) });
}
export async function POST(req: Request) {
  const g = await requireSuperAdmin(req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.email || !b.password || !ROLES.includes(b.role)) return NextResponse.json({ error: "Email, password and valid role required" }, { status: 400 });
  if (String(b.password).length < 6) return NextResponse.json({ error: "Password too short (min 6)" }, { status: 400 });
  try {
    const u = await db.user.create({ data: { email: String(b.email).toLowerCase().trim(), password: await bcrypt.hash(b.password, 10), name: b.name || b.email, role: b.role } });
    await logAudit(g.user.email, "USER_CREATED", `${u.email} (${u.role})`);
    return NextResponse.json({ ok: true, user: { id: u.id, email: u.email } });
  } catch { return NextResponse.json({ error: "Email already exists" }, { status: 400 }); }
}
