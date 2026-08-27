import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const [notifications, unread] = await Promise.all([
    db.notification.findMany({ orderBy: { id: "desc" }, take: 30 }),
    db.notification.count({ where: { read: false } }),
  ]);
  return NextResponse.json({ notifications, unreadCount: unread });
}
export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (b.action === "readAll") await db.notification.updateMany({ data: { read: true } });
  else if (b.action === "read" && b.id) await db.notification.update({ where: { id: Number(b.id) }, data: { read: true } });
  else if (b.action === "clear") await db.notification.deleteMany({});
  return NextResponse.json({ ok: true });
}
