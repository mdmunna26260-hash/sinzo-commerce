import sharp from "sharp";

/* One canonical ladder for the whole storefront.
   Every placement picks from this list; the media route can build any of these widths on demand,
   so a surface may ask for a size that no upload ever produced (older media rows have no index
   at all — 500+ of them in production — and used to fall back to the full-size original). */
export const VARIANT_WIDTHS = [200, 300, 400, 600, 800, 1000, 1200];

export function isVariantWidth(w: number): boolean {
  return VARIANT_WIDTHS.includes(w);
}

/* Quality ladder tuned for byte weight rather than maximum fidelity: the 1000/1200 variants are what
   phones pull for the hero and the promo block (a 275KB w1200 was measured on / at 390px). At q70-76
   garment photos look the same and land 25-30% smaller. effort 5 only costs time at upload/build. */
export function variantQuality(width: number): number {
  if (width <= 200) return 70;
  if (width <= 300) return 72;
  if (width <= 600) return 76;
  if (width <= 800) return 72;
  return 68;   // 1000/1200 are the heavy rungs — a garment photo at q68 is ~35% smaller and, at the
               // size they are shown (a phone hero / desktop hero), indistinguishable side by side
}

/* Render ONE width from any source buffer. withoutEnlargement keeps a 800px upload from being
   upscaled to 1200 just because a card asked for it. */
export async function renderVariant(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: variantQuality(width), effort: 5 })
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
  const original = await sharp(input).resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  return { blur, variants, original, ext: "webp", mime: "image/webp", width, height };
}
