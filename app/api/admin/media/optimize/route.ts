import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { generateVariants, VARIANT_WIDTHS } from "@/lib/image-variants";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Keeps the variant index in step with the storefront ladder.
   Chunked on purpose (5 images per call) so a single request never runs into a lambda timeout:
   the caller loops until `done`. After a deploy this is what turns the ~500 media rows that
   predate the pipeline — and any row missing a newly added width — into real variants, instead
   of letting them fall back to the full-size original. */
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;

  /* Only migrate media that's actually USED (product images, category images,
     hero/promo/any settings URL) — old deleted uploads stay untouched. */
  const [imgs, cats, settings] = await Promise.all([
    db.productImage.findMany({ select: { url: true } }),
    db.category.findMany({ select: { image: true } }),
    db.setting.findMany(),
  ]);
  const urls = [
    ...imgs.map((i) => i.url),
    ...cats.map((c) => c.image).filter(Boolean),
    ...settings.map((s) => JSON.stringify(s).match(/\/api\/media\/[a-z0-9]+/gi) || []).flat(),
  ];
  const refIds = [...new Set(urls.map((u) => (u.match(/media\/([a-z0-9]+)/i) || [])[1]).filter(Boolean))];
  if (!refIds.length) return NextResponse.json({ ok: true, optimized: 0, remaining: 0, done: true });

  const candidates = await db.media.findMany({
    where: { id: { in: refIds }, mime: { startsWith: "image/" } },
    select: { id: true, variantsJson: true },
  });
  const NEED = VARIANT_WIDTHS.map((w) => "w" + w);
  /* force=1 re-encodes media that already has a complete variant set. Needed whenever the encoder
     settings in lib/image-variants.ts change (quality ladder, effort): the URLs are cached for a
     year, so re-encoding only ever *shrinks* the same picture and the index swap is what republishes
     it. Old variant rows are deleted below so the blobs do not pile up in the DB. */
  const force = new URL(req.url).searchParams.get("force") === "1";
  const legacy = candidates
    .filter((r) => {
      if (force) return true;
      if (!r.variantsJson) return true;
      try { const idx = JSON.parse(r.variantsJson); return NEED.some((k) => !idx[k]?.id); } catch { return true; }
    })
    .map((r) => ({ id: r.id }));
  if (!legacy.length) return NextResponse.json({ done: true, remaining: 0, total: candidates.length });
  let optimized = 0;
  for (const { id } of legacy.slice(0, 5)) {
    try {
      const row = await db.media.findUnique({ where: { id } });
      if (!row) continue;
      const v = await generateVariants(Buffer.from(row.data));
      const prevIds: string[] = [];
      try { const idx = JSON.parse(row.variantsJson || "{}"); for (const k of NEED) if (idx[k]?.id) prevIds.push(idx[k].id); } catch {}
      const mk = async (data: Buffer, tag: string) => {
        const r = await db.media.create({ data: { filename: tag + ".webp", mime: "image/webp", size: data.length, data } });
        return { id: r.id, size: r.size };
      };
      const keys = Object.keys(v.variants);
      const index: Record<string, { id: string; size: number }> = {};
      const made = await Promise.all(keys.map((k) => mk(v.variants[k], k)));
      keys.forEach((k, i) => { index[k] = made[i]; });
      await db.media.update({ where: { id }, data: {
        width: v.width, height: v.height, blurData: v.blur,
        variantsJson: JSON.stringify(index),
      }});
      /* drop the replaced blobs — the new variant ids are already what the URL resolves to */
      if (prevIds.length) await db.media.deleteMany({ where: { id: { in: prevIds } } }).catch(() => {});
      optimized++;
    } catch { /* keep going: one bad image must not stall the migration */ }
  }
  const remaining = legacy.length - optimized;
  return NextResponse.json({ ok: true, optimized, remaining, done: remaining <= 0, total: candidates.length });
}
