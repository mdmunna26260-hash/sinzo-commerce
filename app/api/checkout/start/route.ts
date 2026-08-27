import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
// Abandoned-checkout capture (no PII required)
export async function POST(req: Request) {
  try {
    const { items, total } = await req.json();
    await db.abandonedCheckout.create({ data: { cartJson: JSON.stringify(items || []), total: Number(total) || 0 } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false }, { status: 200 }); }
}
