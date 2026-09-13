import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    if (!rateLimit("newsletter:" + getClientIp(req), 3, 24 * 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts from your connection." }, { status: 429 });
    }
    const { email } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    await db.subscriber.upsert({ where: { email: email.toLowerCase() }, update: {}, create: { email: email.toLowerCase() } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
