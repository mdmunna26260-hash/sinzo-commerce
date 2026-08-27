import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    await db.subscriber.upsert({ where: { email: email.toLowerCase() }, update: {}, create: { email: email.toLowerCase() } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
