#!/usr/bin/env node
/* Build every missing storefront variant for the media the shop actually references.
 *
 * Why: media uploaded before the variant pipeline existed (or before a width was added to the
 * ladder) has no index entry, so /api/media/{id}/wXXX falls back to the FULL-SIZE original —
 * a 190px card downloading a 1800px file. The route can build a missing width on demand, but
 * doing it ahead of time means the first shopper never pays for it.
 *
 * Usage (needs DATABASE_URL; run from the project root so @prisma/client resolves):
 *   DATABASE_URL=postgres://… node scripts/gen-variants.mjs            # only what is missing
 *   DATABASE_URL=postgres://… node scripts/gen-variants.mjs --force     # re-encode everything
 *   DATABASE_URL=postgres://… node scripts/gen-variants.mjs --limit 20  # smoke test
 *
 * Width ladder + quality numbers mirror lib/image-variants.ts (keep them in step).
 * On the live server the same job can be driven through POST /api/admin/media/optimize
 * (5 images per call, loops until {done:true}) — no shell access needed.
 */
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const VARIANT_WIDTHS = [200, 300, 400, 600, 800, 1000, 1200];
const quality = (w) => (w <= 200 ? 70 : w <= 300 ? 72 : w <= 600 ? 76 : w <= 800 ? 72 : 68);

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const LIMIT = Number((args[args.indexOf("--limit") + 1] || 0) || 0);

const prisma = new PrismaClient();

const refs = await prisma.$queryRaw`
  select distinct regexp_replace(url, '^.*/media/', '') as id from "ProductImage"
  union select distinct regexp_replace(image, '^.*/media/', '') from "Category" where image is not null
  union select distinct m.match[1] from "Setting" s, regexp_matches(s::text, '/api/media/([a-z0-9]+)', 'gi') as m(match)
`;
const ids = refs.map((r) => r.id).filter((id) => /^[a-z0-9]+$/i.test(id));
console.log(`[variants] referenced media: ${ids.length}`);

const index_rows = await prisma.media.findMany({
  where: { id: { in: ids }, mime: { startsWith: "image/" } },
  select: { id: true, variantsJson: true, size: true },
});
console.log(`[variants] image rows: ${index_rows.length}`);

let done = 0, added = 0, skipped = 0, failed = 0;
const t0 = Date.now();
for (const row of index_rows) {
  if (LIMIT && done >= LIMIT) break;
  let index = {};
  try { index = JSON.parse(row.variantsJson || "{}"); } catch {}
  const keys = VARIANT_WIDTHS.map((w) => "w" + w).filter((k) => FORCE || !index[k]?.id);
  if (!keys.length) { skipped++; continue; }
  try {
    const full = await prisma.media.findUnique({ where: { id: row.id }, select: { data: true } });
    if (!full?.data) { skipped++; continue; }
    const src = Buffer.from(full.data);
    const meta = await sharp(src).metadata();
    const fresh = {};
    for (const key of keys) {
      const w = Number(key.slice(1));
      if (meta.width && w > meta.width) continue;               // never upscale
      const bytes = await sharp(src).resize({ width: w, withoutEnlargement: true })
        .webp({ quality: quality(w), effort: 5 }).toBuffer();
      const created = await prisma.media.create({
        data: { filename: key + ".webp", mime: "image/webp", size: bytes.length, data: bytes },
        select: { id: true, size: true },
      });
      fresh[key] = { id: created.id, size: created.size };
      added++;
    }
    if (Object.keys(fresh).length) {
      await prisma.media.update({
        where: { id: row.id },
        data: { variantsJson: JSON.stringify({ ...index, ...fresh }) },
      });
      /* the replaced blobs are unreachable now — drop them so the DB does not grow forever */
      const stale = Object.values(index).map((v) => v?.id).filter((id) => id && !Object.values(fresh).some((f) => f.id === id));
      if (stale.length) { try { await prisma.media.deleteMany({ where: { id: { in: stale } } }); } catch {} }
    }
    done++;
    if (done % 25 === 0) console.log(`[variants] ${done} images · ${added} new blobs · ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    failed++;
    console.log(`[variants] FAILED ${row.id}: ${e.message}`);
  }
}
console.log(`[variants] DONE — updated ${done}, blobs added ${added}, already complete ${skipped}, failed ${failed}, ${Math.round((Date.now() - t0) / 1000)}s`);
await prisma.$disconnect();
