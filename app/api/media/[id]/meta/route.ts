import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({ where: { id: params.id }, select: { width: true, height: true } }).catch(() => null);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ width: m.width || 800, height: m.height || 1200 });
}
