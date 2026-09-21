import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { ensureExtraTables } = await import("@/lib/db-ensure");
    await ensureExtraTables().catch(() => {});
    if (!rateLimit("newsletter:" + getClientIp(req), 3, 24 * 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts from your connection." }, { status: 429 });
    }
    const { email } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    /* Joining again is a deliberate act, so it clears an earlier unsubscribe — otherwise a
       customer who changed their mind would stay silently excluded for ever. */
    await db.subscriber.upsert({
      where: { email: email.toLowerCase() },
      update: { unsubscribed: false, unsubscribedAt: null },
      create: { email: email.toLowerCase() },
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
