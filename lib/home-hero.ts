import { isSameOriginPath } from "./url-guard";

export const MAX_HERO_SLIDES = 5;

export type HomeHeroSlide = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  image: string;
  mobileImage: string;
  enabled: boolean;
};

type HeroProduct = {
  id: number;
  title: string;
  slug: string;
  image?: string | null;
  categoryName?: string | null;
};

function shortText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeImage(value: unknown): string {
  const image = shortText(value, 2_000);
  if (!image || /[\r\n\\]/.test(image)) return "";
  if (image.startsWith("/") && !image.startsWith("//")) return image;
  try {
    const parsed = new URL(image);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeHref(value: unknown): string {
  const href = shortText(value, 500);
  return isSameOriginPath(href) ? href : "/products";
}

/* Used both by the admin write path and the storefront. Keeping the bounds here
   prevents an accidentally huge settings object from becoming a homepage payload. */
export function sanitizeHeroSlides(value: unknown, includeDisabled = true): HomeHeroSlide[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HERO_SLIDES).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const slide = raw as Record<string, unknown>;
    const enabled = slide.enabled !== false;
    const image = safeImage(slide.image);
    if (!image || (!enabled && !includeDisabled)) return [];
    return [{
      id: shortText(slide.id, 80) || `manual-${index + 1}`,
      eyebrow: shortText(slide.eyebrow, 80),
      title: shortText(slide.title, 160),
      subtitle: shortText(slide.subtitle, 280),
      cta: shortText(slide.cta, 50) || "Shop now",
      href: safeHref(slide.href),
      image,
      mobileImage: safeImage(slide.mobileImage),
      enabled,
    }];
  });
}

/* Hybrid mode: saved carousel slides win. Until the merchant creates those,
   preserve the legacy hero as slide one and complete the carousel from the live
   featured catalogue. No invented campaigns, prices or urgency are introduced. */
export function buildHomeHeroSlides(homepage: Record<string, unknown> | null | undefined, products: HeroProduct[]): HomeHeroSlide[] {
  const manual = sanitizeHeroSlides(homepage?.heroSlides, false);
  if (manual.length) return manual;

  const slides: HomeHeroSlide[] = [];
  const legacyImage = safeImage(homepage?.heroImage);
  if (legacyImage) {
    slides.push({
      id: "legacy-hero",
      eyebrow: shortText(homepage?.heroEyebrow, 80) || "New season · SINZO",
      title: shortText(homepage?.heroTitle, 160) || "Quiet luxury. Everyday ease.",
      subtitle: shortText(homepage?.heroSubtitle, 280) || "Thoughtfully selected pieces for a refined everyday wardrobe.",
      cta: shortText(homepage?.heroCta, 50) || "Shop now",
      href: safeHref(homepage?.heroHref),
      image: legacyImage,
      mobileImage: safeImage(homepage?.heroMobileImage),
      enabled: true,
    });
  }

  const usedImages = new Set(slides.map((slide) => slide.image));
  for (const product of products) {
    const image = safeImage(product.image);
    if (!image || usedImages.has(image)) continue;
    slides.push({
      id: `catalog-${product.id}`,
      eyebrow: shortText(product.categoryName, 80) || "Featured selection",
      title: shortText(product.title, 160),
      subtitle: "A considered piece from our current collection.",
      cta: "View piece",
      href: `/products/${encodeURIComponent(product.slug)}`,
      image,
      mobileImage: "",
      enabled: true,
    });
    usedImages.add(image);
    if (slides.length >= 4) break;
  }

  return slides.slice(0, MAX_HERO_SLIDES);
}
