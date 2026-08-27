import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { steadfastCfg, testConnection } from "@/lib/steadfast";
export const dynamic = "force-dynamic";
// REAL Steadfast connection test (works on portal.packzy.com).
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const cfg = await steadfastCfg();
  if (!cfg.configured) {
    return NextResponse.json({ ok: false, configured: false, error: "API Key & Secret Key din (Admin > Settings > Courier)" }, { status: 400 });
  }
  const r = await testConnection();
  return NextResponse.json({ ok: r.ok, configured: true, apiUrl: cfg.apiUrl, detail: r.detail, data: r.data ?? null }, { status: r.ok ? 200 : 502 });
}
