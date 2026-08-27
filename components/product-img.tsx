"use client";
import { useEffect, useState } from "react";

export type ImgInfo = { url: string; width?: number | null; height?: number | null };

function variantUrl(url: string, w: number): string {
  // media URLs: /api/media/<id> → /api/media/<id>/w<w>
  const m = url.match(/^\/api\/media\/([a-z0-9]+)$/i);
  return m ? `/api/media/${m[1]}/w${w}` : url;
}

/* Responsive, blur-up, CLS-free product image.
   - srcset 300/600/1000/1200 (browser picks per viewport/DPR)
   - blur placeholder painted instantly via tiny img (or CSS background fallback)
   - lazy by default; priority for above-the-fold main image */
export default function ProductImg({ img, alt, className, priority, style, onMouseEnter, onMouseLeave, onMouseMove }: {
  img?: ImgInfo | null; alt: string; className?: string; priority?: boolean; style?: React.CSSProperties;
  onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: (e: React.MouseEvent) => void; onMouseMove?: (e: React.MouseEvent) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const url = img?.url || "";
  const isMedia = /^\/api\/media\/[a-z0-9]+$/i.test(url);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    img?.width && img?.height ? { w: img.width, h: img.height } : null
  );

  useEffect(() => { setLoaded(false); }, [url]);
  useEffect(() => {
    if (!dims && isMedia && url) {
      fetch(url).then((r) => r.json()).then((j) => {
        if (j?.width && j?.height) setDims({ w: j.width, h: j.height });
      }).catch(() => {});
    }
  }, [url, isMedia]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratio = dims ? dims.w / dims.h : 3 / 4;
  const srcSet = isMedia
    ? [300, 600, 1000, 1200].map((w) => `${variantUrl(url, w)} ${w}w`).join(", ")
    : undefined;
  const mainSrc = isMedia ? variantUrl(url, 600) : url;

  return (
    <div
      className={"pimg" + (className ? " " + className : "")}
      style={{ aspectRatio: `${ratio}`, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      {/* blur placeholder */}
      {isMedia && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${url}/blur`} alt="" aria-hidden className="pimg-blur" />
      )}
      {!url ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mainSrc}
          srcSet={srcSet}
          sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 300px"
          alt={alt}
          className={"pimg-main" + (loaded ? " loaded" : "")}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          {...(priority ? { fetchPriority: "high" as const } : {})}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
