import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/* Cheapest possible lambda-warming endpoint (no DB). Ping this (or "/") from a
   free external cron every ~5-10 min so the serverless function never sleeps
   between customers. */
export function GET() {
  return NextResponse.json({ ok: true, at: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
