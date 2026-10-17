export type HomeSectionConfig = { id: string; enabled: boolean };

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { id: "hero", enabled: true },
  { id: "values", enabled: true },
  { id: "quicklinks", enabled: true },
  { id: "featured", enabled: true },
  { id: "categories", enabled: true },
  { id: "discounts", enabled: true },
  { id: "promo", enabled: true },
  { id: "bestsellers", enabled: true },
  { id: "limited", enabled: true },
  { id: "recently", enabled: true },
  { id: "testimonials", enabled: true },
];

/* Insert newly shipped sections beside their intended neighbour without
   rearranging any sections the merchant has already ordered. */
export function mergeHomeSections(value: unknown): HomeSectionConfig[] {
  const saved = Array.isArray(value)
    ? value.flatMap((item): HomeSectionConfig[] => item && typeof item === "object" && typeof item.id === "string"
      ? [{ id: item.id, enabled: item.enabled !== false }]
      : [])
    : [];
  if (!saved.length) return DEFAULT_HOME_SECTIONS.map((section) => ({ ...section }));

  const merged = saved.slice();
  DEFAULT_HOME_SECTIONS.forEach((section, defaultIndex) => {
    if (merged.some((item) => item.id === section.id)) return;
    const precedingIds = DEFAULT_HOME_SECTIONS.slice(0, defaultIndex).map((item) => item.id);
    let insertAfter = -1;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (precedingIds.includes(merged[index].id)) { insertAfter = index; break; }
    }
    merged.splice(insertAfter + 1, 0, { ...section });
  });
  return merged;
}
