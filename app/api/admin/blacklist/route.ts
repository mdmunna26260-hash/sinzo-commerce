import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ entries: await db.blacklist.findMany({ orderBy: { id: "desc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.value) return NextResponse.json({ error: "Value required" }, { status: 400 });
  await db.blacklist.create({ data: { type: b.type || "PHONE", value: String(b.value).trim(), note: b.note || null } });
  await logAudit(g.user.email, "BLACKLIST_ADD", `${b.type}: ${b.value}`);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  // the old `.catch(() => {})` answered ok even when the row was never removed
  const deleted = await db.blacklist.deleteMany({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Could not remove the entry" }, { status: 500 });
  if (!deleted.count) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
