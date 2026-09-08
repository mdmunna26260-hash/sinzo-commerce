import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";

/* Client-side crash reporter.
   Browser errors (error boundaries) POST here so the exact failure is visible
   server-side (Admin → Tracking) even without the phone's console.
   Rate-limited; silently 204s on any failure so it never worsens a crash. */
export async function POST(req: Request) {
  try {
    if (!rateLimit("cerr:" + getClientIp(req), 20, 10 * 60 * 1000)) return new Response(null, { status: 204 });
    const b = await req.json().catch(() => ({}));
    const message = String(b.message || "unknown").slice(0, 500);
    const stack = String(b.stack || "").slice(0, 1500);
    const url = String(b.url || "").slice(0, 300);
    const ua = req.headers.get("user-agent") || "";
    await db.trackingEvent.create({
      data: {
        name: "client-error",
        eventId: b.digest ? String(b.digest).slice(0, 100) : null,
        source: "browser",
        payload: JSON.stringify({ url, ua: ua.slice(0, 200), stack }),
        ok: false,
        error: message,
      },
    }).catch(() => {});
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
