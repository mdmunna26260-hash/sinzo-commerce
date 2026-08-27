import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("orders", req); // any valid session passes
  if ("res" in g) return g.res;
  return NextResponse.json({ ok: true, user: { email: g.user.email, name: g.user.name, role: g.user.role } });
}
