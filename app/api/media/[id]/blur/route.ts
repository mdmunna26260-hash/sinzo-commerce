import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
/* Tiny blur placeholder (webp ~24px) — instant paint before main image loads. */
export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({ where: { id: params.id }, select: { blurData: true } }).catch(() => null);
  if (!m?.blurData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(m.blurData), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
