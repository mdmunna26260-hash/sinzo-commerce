import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
/* 24px LQIP — tiny; cached forever by browser + edge. */
export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({ where: { id: params.id }, select: { blurData: true } }).catch(() => null);
  if (!m?.blurData) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(m.blurData), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable, s-maxage=31536000" },
  });
}
