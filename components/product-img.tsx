"use client";
import { useEffect, useState } from "react";

export type ImgInfo = { url: string; width?: number | null; height?: number | null };

function variantUrl(url: string, w: number): string {
  const m = url.match(/^\/api\/media\/([a-z0-9]+)$/i);
  return m ? `/api/media/${m[1]}/w${w}` : url;
}

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
      fetch(url + "/meta").then((r) => r.json()).then((j) => {
        if (j?.width && j?.height) setDims({ w: j.width, h: j.height });
      }).catch(() => {});
    }
  }, [url, isMedia]);

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
      {isMedia && !loaded && (
        <img src={`${url}/blur`} alt="" aria-hidden className="pimg-blur" />
      )}
      {!url ? null : (
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
