import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string; variant: string } };

/* Images are immutable — a new upload always gets a new media id — so a variant
   URL can be cached forever.
   - max-age+immutable  → browser never re-requests it
   - s-maxage + stale-while-revalidate → the Vercel edge CDN serves every other
     visitor instantly; the lambda + DB are hit at most once per URL globally */
const CACHE = "public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400";
const NOSTORE = "no-store";

export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({
    where: { id: params.id },
    select: { variantsJson: true }, // never pull the big primary blob just to read the index
  }).catch(() => null);
  if (!m?.variantsJson) return new Response(null, { status: 404, headers: { "Cache-Control": NOSTORE } });

  let idx: any = {};
  try { idx = JSON.parse(m.variantsJson); } catch { return new Response(null, { status: 404, headers: { "Cache-Control": NOSTORE } }); }
  const v = idx[params.variant];

  if (v?.id) {
    const row = await db.media.findUnique({ where: { id: v.id }, select: { data: true, size: true } });
    if (row) {
      return new Response(new Uint8Array(row.data), {
        headers: { "Content-Type": "image/webp", "Content-Length": String(row.size), "Cache-Control": CACHE },
      });
    }
  }
  /* GRACEFUL FALLBACK (legacy uploads without this variant):
     serve the original instead of a broken image. Still immutable + edge-cached;
     once the optimize migration generates the real variant, new uploads of the
     same URL keep working (content only gets smaller/sharper). */
  const orig = await db.media.findUnique({
    where: { id: params.id },
    select: { data: true, size: true, mime: true },
  }).catch(() => null);
  if (!orig) return new Response(null, { status: 404, headers: { "Cache-Control": NOSTORE } });
  return new Response(new Uint8Array(orig.data), {
    headers: { "Content-Type": orig.mime || "image/webp", "Content-Length": String(orig.size), "Cache-Control": CACHE },
  });
}
