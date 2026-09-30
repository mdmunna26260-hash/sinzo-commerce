"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import CardGallery from "./card-gallery";
import CardImg from "./card-img";

/* The card's media block: the product photo(s) plus the image pagination dots that sit
   UNDER the image (the owner's reference: one dot per photo, the current one bigger and
   dark, the others small and light — PacSun-style).

   Why the dots live here and not inside CardGallery: `.pcard-img` clips its content
   (`overflow: hidden`, needed by the sliding track), so anything drawn "below the image"
   has to be a sibling of that box. The gallery reports its index up (`onIndexChange`) and
   this wrapper draws the row, so the dots can never be cropped or sit on top of the photo.

   The dots are decoration, never buttons — the whole card is one <a>, and an <a> may not
   contain interactive elements. Tapping the row therefore opens the product, like the
   rest of the card. */
export default function CardMedia({ images, image, alt, slug, children }: {
  images?: string[]; image?: string; alt: string; slug?: string; children?: ReactNode;
}) {
  const pics = (images || []).filter(Boolean);
  const [i, setI] = useState(0);
  return (
    <div className="pcard-media">
      {/* `children` = the badges, which must stay inside the clipped image box */}
      <div className="pcard-img" data-vt-slug={slug || undefined}>
        {pics.length > 1
          ? <CardGallery images={pics} alt={alt} onIndexChange={setI} />
          : image ? <CardImg url={image} alt={alt} slug={slug} /> : null}
        {children}
      </div>
      {pics.length > 1 && (
        <span className="pcard-dots" aria-hidden>
          {pics.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}
        </span>
      )}
    </div>
  );
}
