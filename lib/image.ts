import { getSettings } from "./settings";

/* Auto-normalize uploaded product images to the store's configured aspect ratio.
   Centre-crops to the exact ratio (no upscaling), caps resolution, keeps format.
   Falls back to the original file if sharp is unavailable. */
export function parseRatio(s?: string | null): number {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec((s || "").trim());
  if (!m) return 3 / 4;
  const r = parseFloat(m[1]) / parseFloat(m[2]);
  return r > 0 && r < 10 ? r : 3 / 4;
}
export async function productImageRatio(): Promise<number> {
  try {
    const s = await getSettings();
    return parseRatio(s.theme?.productImageRatio || "3:4");
  } catch { return 3 / 4; }
}
export async function processProductImage(buf: Buffer, mimeType: string): Promise<{ buffer: Buffer; ext: string; processed: boolean }> {
  try {
    const ratio = await productImageRatio();
    const mod = await import("sharp");
    const sharp = (mod.default || mod) as any;
    let img = sharp(buf).rotate(); // respect EXIF orientation
    const meta = await img.metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    if (srcW > 0 && srcH > 0) {
      const srcRatio = srcW / srcH;
      if (Math.abs(srcRatio - ratio) > 0.01) {
        // centre-crop to the exact target ratio (no upscale)
        let cropW = srcW, cropH = srcH;
        if (srcRatio > ratio) { cropW = Math.round(srcH * ratio); }
        else { cropH = Math.round(srcW / ratio); }
        const left = Math.max(0, Math.floor((srcW - cropW) / 2));
        const top = Math.max(0, Math.floor((srcH - cropH) / 2));
        img = img.extract({ left, top, width: Math.min(cropW, srcW), height: Math.min(cropH, srcH) });
      }
      // resolution cap on the long edge = 1200px
      const capLong = 1200;
      const capW = ratio >= 1 ? capLong : Math.round(capLong * ratio);
      const capH = ratio >= 1 ? Math.round(capLong / ratio) : capLong;
      img = img.resize({ width: capW, height: capH, fit: "inside", withoutEnlargement: true });
    }
    if (mimeType === "image/gif") img = img.png();
    const out = await img.toBuffer({ resolveWithObject: true });
    const fmt = out.info.format;
    const ext = fmt === "png" ? "png" : fmt === "webp" ? "webp" : fmt === "avif" ? "avif" : "jpg";
    return { buffer: out.data, ext, processed: true };
  } catch {
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "jpg";
    return { buffer: buf, ext, processed: false };
  }
}
