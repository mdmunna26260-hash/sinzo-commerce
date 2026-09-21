import { NextResponse } from "next/server";
import { runWaTick } from "@/lib/wa-worker";
import { waWorkerAuthorized } from "@/lib/wa";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The worker endpoint — scripts/wa-worker.js calls this every ~20 s (PM2, or a VPS cron with
   `curl -H "x-wa-worker-key: …" -X POST …/api/wa/tick`).
   One tick = claim a small batch, send it respecting caps/quiet hours/pacing, update receipts.
   Sends never happen inside a customer request; this endpoint is only ever called by the worker
   (or by an admin pressing "run now"), and it is key-protected. */
export async function POST(req: Request) {
  if (!(await waWorkerAuthorized(req))) {
    return NextResponse.json({ error: "bad worker key" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({} as any));
  const report = await runWaTick({
    limit: Number(body?.limit) || 5,
    force: body?.force === true,
  });
  return NextResponse.json(report);
}

export async function GET(req: Request) {
  if (!(await waWorkerAuthorized(req))) return NextResponse.json({ error: "bad worker key" }, { status: 401 });
  const url = new URL(req.url);
  return NextResponse.json(await runWaTick({ limit: Number(url.searchParams.get("limit")) || 3 }));
}
