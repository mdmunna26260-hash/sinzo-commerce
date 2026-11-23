/* Size presets add missing sizes without replacing existing inventory or IDs. */
export function appendSizePreset(editor: any, kind: "alpha" | "numeric") {
  const sizes = kind === "alpha" ? ["S", "M", "L", "XL", "XXL"] : ["28", "30", "32", "34", "36", "38", "40"];
  const variants = editor.variants || [];
  const color = variants[0]?.color || "";
  const existing = new Set(variants.filter((v: any) => (v.color || "").toLowerCase() === color.toLowerCase()).map((v: any) => String(v.size).trim().toLowerCase()));
  return [...variants, ...sizes.filter(size => !existing.has(size.toLowerCase())).map(size => ({ size, color, sku: (editor.sku ? editor.sku + "-" : "") + size, price: "", stock: "0", image: "" }))];
}
export function productEditorPayload(edit: any, status: string) {
  const optionalNumber = (value: any) => value === "" || value == null ? null : Number(value);
  if ((edit.comboTiers || []).some((t: any) => (t.qty || t.total) && (!t.qty || t.total === ""))) throw new Error("Complete or remove each combo tier before saving.");
  return {
    ...edit, status,
    price: edit.price === "" || edit.price == null ? undefined : Number(edit.price),
    comparePrice: optionalNumber(edit.comparePrice), cost: optionalNumber(edit.cost),
    stock: Number(edit.stock === "" ? 0 : edit.stock), lowStock: Number(edit.lowStock === "" ? 5 : edit.lowStock),
    soldCount: optionalNumber(edit.soldCount), saleEnds: edit.saleEnds ? new Date(edit.saleEnds).toISOString() : null,
    preorder: !!edit.preorder, preorderDate: edit.preorderDate ? new Date(edit.preorderDate + "T12:00:00").toISOString() : null,
    soldMode: edit.soldMode === "random" ? "random" : "fixed", comboEligible: !!edit.comboEligible,
    outsideDeliveryFee: optionalNumber(edit.outsideDeliveryFee),
    comboOffers: (edit.comboTiers || []).filter((t: any) => t.qty !== "" && t.total !== "").map((t: any) => ({ qty: Number(t.qty), total: Number(t.total) })),
    colorGroupId: edit.colorGroupId ? Number(edit.colorGroupId) : null,
    colorName: edit.colorName ? String(edit.colorName).trim().slice(0, 40) : null, colorImage: edit.colorImage || null,
    categoryId: edit.categoryId ? Number(edit.categoryId) : null,
    variants: (edit.variants || []).map((v: any) => ({ ...v, price: optionalNumber(v.price), stock: Number(v.stock === "" ? 0 : v.stock) })),
  };
}
