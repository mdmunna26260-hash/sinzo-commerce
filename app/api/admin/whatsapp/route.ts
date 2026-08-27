import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { waStatus } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const [status, s] = await Promise.all([waStatus(), envFallback(await getSettings())]);
  const n = s.notifications || {};
  return NextResponse.json({
    bridgeRunning: status.running,
    connected: status.connected,
    me: status.me,
    qrPending: status.qrPending,
    waEnabled: n.waEnabled !== false,
    waCustomerEnabled: n.waCustomerEnabled !== false,
    waNotifyNumber: n.waNotifyNumber || "",
  });
}
