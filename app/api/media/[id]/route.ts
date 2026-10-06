import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
/* Original (capped 2400px WebP). Immutable → browser + edge CDN cache forever. */
const CACHE = "public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400";

export async function GET(_: Request, props: Ctx) {
  const params = await props.params;
  const m = await db.media.findUnique({
    where: { id: params.id },
    select: { data: true, size: true, mime: true },
  }).catch(() => null);
  if (!m) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(m.data), {
    headers: {
      "Content-Type": m.mime,
      "Content-Length": String(m.size),
      "Cache-Control": CACHE,
    },
  });
}
