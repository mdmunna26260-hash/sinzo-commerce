import { db } from "./db";
import { generateVariants } from "./image-variants";

/* Storage model:
   - One PRIMARY Media row per uploaded image (keeps original + blurData + variantsJson index)
   - Each responsive variant stored as its own Media row; variantsJson points to their IDs.
   URLs stay stable: /api/media/<primaryId>  and /api/media/<primaryId>/w600 etc. */
export type VariantIndex = Record<string, { id: string; size: number }>;

export async function createMediaWithVariants(buf: Buffer, mime: string, keepRatio = false) {
  const v = await generateVariants(buf);
  const mk = async (data: Buffer, tag: string) => {
    const row = await db.media.create({ data: {
      filename: tag + ".webp", mime: "image/webp", size: data.length, data,
    }});
    return { id: row.id, size: row.size };
  };
  const [b300, b600, b1000, b1200] = await Promise.all([
    mk(v.w300, "w300"), mk(v.w600, "w600"), mk(v.w1000, "w1000"), mk(v.w1200, "w1200"),
  ]);
  const primary = await db.media.create({ data: {
    filename: "img-" + Date.now().toString(36) + ".webp", mime: "image/webp",
    size: v.original.length, data: v.original,
    width: v.width, height: v.height, blurData: v.blur,
    variantsJson: JSON.stringify({ w300: b300, w600: b600, w1000: b1000, w1200: b1200 }),
  }});
  return { primaryId: primary.id, width: v.width, height: v.height };
}
