import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderVariant, isVariantWidth } from "@/lib/image-variants";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; variant: string }> };

/* Images are immutable — a new upload always gets a new media id — so a variant
   URL can be cached forever.
   - max-age+immutable  → browser never re-requests it
   - s-maxage + stale-while-revalidate → the Vercel edge CDN serves every other
     visitor instantly; the lambda + DB are hit at most once per URL globally */
const CACHE = "public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400";
const NOSTORE = "no-store";

/* Requested width → bytes. Reads the parent row, finds the variant in the index, and
   builds + stores it when it is missing (self-healing: the 500+ media rows uploaded before
   the variant pipeline existed have no index at all and used to hand out full-size originals).
   Only the canonical ladder is buildable — arbitrary widths would let a crawler pin the CPU. */
async function buildAndStore(id: string, width: number, index: Record<string, { id: string; size: number }>) {
  const orig = await db.media.findUnique({ where: { id }, select: { data: true } });
  if (!orig?.data) return null;
  const bytes = await renderVariant(Buffer.from(orig.data), width);
  const row = await db.media.create({ data: {
    filename: `w${width}.webp`, mime: "image/webp", size: bytes.length, data: bytes,
  }});
  const next = { ...index, ["w" + width]: { id: row.id, size: row.size } };
  // last write wins; a racing request only wastes one blob, it never breaks the index
  await db.media.update({ where: { id }, data: { variantsJson: JSON.stringify(next) } }).catch(() => {});
  return bytes;
}

export async function GET(_: Request, props: Ctx) {
  const params = await props.params;
  const m = await db.media.findUnique({
    where: { id: params.id },
    select: { variantsJson: true }, // never pull the big primary blob just to read the index
  }).catch(() => null);
  if (!m) return new Response(null, { status: 404, headers: { "Cache-Control": NOSTORE } });

  let index: Record<string, { id: string; size: number }> = {};
  try { if (m.variantsJson) index = JSON.parse(m.variantsJson); } catch {}

  const hit = index[params.variant];
  if (hit?.id) {
    const row = await db.media.findUnique({ where: { id: hit.id }, select: { data: true, size: true } });
    if (row) {
      return new Response(new Uint8Array(row.data), {
        headers: { "Content-Type": "image/webp", "Content-Length": String(row.size), "Cache-Control": CACHE },
      });
    }
  }

  /* Miss → build it once (allowed widths only), then it is cached forever like any other variant. */
  const width = Number((/^w(\d+)$/.exec(params.variant) || [])[1] || 0);
  if (width && isVariantWidth(width)) {
    try {
      const built = await buildAndStore(params.id, width, index);
      if (built) {
        return new Response(new Uint8Array(built), {
          headers: { "Content-Type": "image/webp", "Content-Length": String(built.length), "Cache-Control": CACHE },
        });
      }
    } catch { /* fall through to the original — an image must never break */ }
  }

  /* FALLBACK: serve the original bytes. Still immutable + edge-cached. */
  const orig = await db.media.findUnique({
    where: { id: params.id },
    select: { data: true, size: true, mime: true },
  }).catch(() => null);
  if (!orig) return new Response(null, { status: 404, headers: { "Cache-Control": NOSTORE } });
  return new Response(new Uint8Array(orig.data), {
    headers: { "Content-Type": orig.mime || "image/webp", "Content-Length": String(orig.size), "Cache-Control": CACHE },
  });
}
