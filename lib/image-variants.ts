import sharp from "sharp";

/* One canonical ladder for the whole storefront.
   Every placement picks from this list; the media route can build any of these widths on demand,
   so a surface may ask for a size that no upload ever produced (older media rows have no index
   at all — 500+ of them in production — and used to fall back to the full-size original). */
export const VARIANT_WIDTHS = [200, 300, 400, 600, 800, 1000, 1200];

export function isVariantWidth(w: number): boolean {
  return VARIANT_WIDTHS.includes(w);
}

/* Quality ladder balanced for a ~50-60 product catalog: thumbnails stay lean (they are tiny on
   screen and there are many of them per page), while the rungs a desktop actually displays
   (w800-w1200 PDP/hero) get high quality so images stay sharp on PC. effort 6 squeezes ~5-10%
   more bytes out at the SAME visual quality — it only costs CPU at upload time. */
export function variantQuality(width: number): number {
  /* Raised vs the old ladder (68→75 … 84→90): WebP at these levels is still ~30-50% smaller
     than JPEG at equal sharpness, so cards stay fast while mobile (DPR 2-3 picks w400-w600)
     and desktop PDP (w1000) no longer look soft. effort 6 keeps bytes down at same quality. */
  if (width <= 200) return 75;
  if (width <= 300) return 78;
  if (width <= 400) return 80;
  if (width <= 600) return 83;
  if (width <= 800) return 86;
  if (width <= 1000) return 88;  // desktop PDP main image lands here — keep it sharp
  return 90;                      // w1200 — og/social + very wide screens
}

/* Render ONE width from any source buffer. withoutEnlargement keeps a 800px upload from being
   upscaled to 1200 just because a card asked for it. */
export async function renderVariant(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: variantQuality(width), effort: 6 })
    .toBuffer();
}

export type VariantSet = {
  blur: Buffer;
  variants: Record<string, Buffer>;   // { w200: <Buffer>, w300: <Buffer>, ... } — only those that differ from the source
  original: Buffer;
  ext: string; mime: string; width: number; height: number;
};

export async function generateVariants(input: Buffer): Promise<VariantSet> {
  const meta = await sharp(input).metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1400;
  const blur = await sharp(input).resize({ width: 24 }).webp({ quality: 40 }).toBuffer();
  const rendered = await Promise.all(VARIANT_WIDTHS.map((w) => renderVariant(input, w)));
  /* A width that rendered to the same pixel size as the source is the source — storing it twice
     only wastes a row, so it is dropped from the index (the route falls through to the original). */
  const variants: Record<string, Buffer> = {};
  VARIANT_WIDTHS.forEach((w, i) => { if (w <= width) variants["w" + w] = rendered[i]; });
  const original = await sharp(input).resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 90, effort: 6 }).toBuffer();
  return { blur, variants, original, ext: "webp", mime: "image/webp", width, height };
}
