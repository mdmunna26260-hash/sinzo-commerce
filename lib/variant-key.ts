/* Shared, client-safe variant key helper (NO sharp import — this module is pulled into
   the browser bundle via components/img-src.ts). Bump QUALITY_VERSION when the quality
   ladder changes so old blobs are bypassed and re-rendered once at the new quality. */
export const QUALITY_VERSION = 2;
export const variantKey = (w: number) => `w${w}v${QUALITY_VERSION}`;
export const VARIANT_RE = /^w(\d+)v(\d+)$/;
