import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { waGetQr } from "@/lib/wa";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const r = await waGetQr();
  return NextResponse.json(r);
}
