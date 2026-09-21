import { db } from "./db";
import { generateVariants } from "./image-variants";

export async function createMediaWithVariants(buf: Buffer, mime: string, keepRatio = false) {
  const v = await generateVariants(buf);
  const mk = async (data: Buffer, tag: string) => {
    const row = await db.media.create({ data: {
      filename: tag + ".webp", mime: "image/webp", size: data.length, data,
    }});
    return { id: row.id, size: row.size };
  };
  /* Every ladder width is stored, so any surface (card thumb, gallery slide, PDP hero, banner)
     finds its own file ready — nothing falls back to the full-size original. */
  const keys = Object.keys(v.variants);
  const stored = await Promise.all(keys.map((k) => mk(v.variants[k], k)));
  const index: Record<string, { id: string; size: number }> = {};
  keys.forEach((k, i) => { index[k] = stored[i]; });

  const primary = await db.media.create({ data: {
    filename: "img-" + Date.now().toString(36) + ".webp", mime: "image/webp",
    size: v.original.length, data: v.original,
    width: v.width, height: v.height, blurData: v.blur,
    variantsJson: JSON.stringify(index),
  }});
  return { primaryId: primary.id, width: v.width, height: v.height };
}
