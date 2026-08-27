import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { waLogout } from "@/lib/wa";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  return NextResponse.json(await waLogout());
}
