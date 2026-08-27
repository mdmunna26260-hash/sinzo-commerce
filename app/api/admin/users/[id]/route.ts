import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = Number(params.id);
  const data: any = {};
  if (b.name) data.name = b.name;
  if (b.role) data.role = b.role;
  if (b.active !== undefined) data.active = !!b.active;
  if (b.password) { if (String(b.password).length < 6) return NextResponse.json({ error: "Password too short" }, { status: 400 }); data.password = await bcrypt.hash(b.password, 10); }
  await db.user.update({ where: { id }, data });
  await logAudit(g.user.email, "USER_UPDATED", `user #${id}`);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  if (id === g.user.id) return NextResponse.json({ error: "You cannot delete yourself" }, { status: 400 });
  const u = await db.user.delete({ where: { id } }).catch(() => null);
  if (u) await logAudit(g.user.email, "USER_DELETED", u.email);
  return NextResponse.json({ ok: true });
}
