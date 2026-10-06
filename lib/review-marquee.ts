/* Keep both animation halves identical. Short review lists are repeated to
   fill the storefront's desktop width, without dropping any original review. */
export function makeReviewLoop<T>(reviews: readonly T[], minimumCards = 4): T[] {
  if (!reviews.length) return [];
  const copies = Math.max(1, Math.ceil(minimumCards / reviews.length));
  return Array.from({ length: copies * reviews.length }, (_, index) => reviews[index % reviews.length]);
}
