import sharp from "sharp";

export type VariantSet = {
  blur: Buffer; w300: Buffer; w600: Buffer; w1000: Buffer; w1200: Buffer; original: Buffer;
  ext: string; mime: string; width: number; height: number;
};

const WIDTHS = [300, 600, 1000, 1200];

async function one(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: width <= 300 ? 72 : 80, effort: 4 })
    .toBuffer();
}

export async function generateVariants(input: Buffer): Promise<VariantSet> {
  const meta = await sharp(input).metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1400;
  const blur = await sharp(input).resize({ width: 24 }).webp({ quality: 40 }).toBuffer();
  const [w300, w600, w1000, w1200] = await Promise.all(WIDTHS.map((w) => one(input, w)));
  const original = await sharp(input).resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  return { blur, w300, w600, w1000, w1200, original, ext: "webp", mime: "image/webp", width, height };
}
