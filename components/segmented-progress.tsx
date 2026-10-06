"use client";

type Props = {
  count: number;
  activeIndex: number;
  className?: string;
  onSelect?: (index: number) => void;
  label?: string;
};

/* Thin, equal-width image indicators shared by the product cards and PDP galleries.
   They stay decorative inside product-card links, but are tappable navigation controls
   on the product detail page. */
export default function SegmentedProgress({
  count,
  activeIndex,
  className = "",
  onSelect,
  label = "Image pagination",
}: Props) {
  if (count <= 1) return null;

  const current = Math.min(Math.max(activeIndex, 0), count - 1);
  const interactive = typeof onSelect === "function";

  return (
    <div
      className={["image-progress", className].filter(Boolean).join(" ")}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? label : undefined}
      aria-hidden={interactive ? undefined : true}
    >
      {Array.from({ length: count }, (_, index) => {
        const segmentClass = "image-progress-segment" + (index === current ? " is-active" : "");
        return interactive ? (
          <button
            key={index}
            type="button"
            className={segmentClass}
            aria-label={`Show image ${index + 1}`}
            aria-current={index === current ? "step" : undefined}
            onClick={() => onSelect(index)}
          />
        ) : (
          <span key={index} className={segmentClass} aria-hidden="true" />
        );
      })}
    </div>
  );
}
