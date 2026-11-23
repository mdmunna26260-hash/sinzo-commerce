export const SETTINGS_SECTIONS: Record<string, string[]> = {
  Store: ["store"], Theme: ["theme", "homepage"], "Homepage Layout": ["homeSections", "homepage"],
  Shipping: ["shipping"], Policies: ["policies"], Courier: ["courier"],
  "Checkout & Fraud": ["checkout", "fraud"], Notifications: ["notifications", "integrations"],
  "SEO & Maintenance": ["seo", "maintenance"],
};
export const SETTINGS_GROUP_LABELS: Record<string, string> = {
  store: "Store", theme: "Theme", homepage: "Homepage content", homeSections: "Layout", shipping: "Shipping",
  policies: "Policies", courier: "Courier", checkout: "Checkout", fraud: "Fraud", notifications: "Notifications",
  integrations: "Integrations", seo: "SEO", maintenance: "Maintenance",
};
export function changedSettingsGroups(current: Record<string, any>, saved: Record<string, any>) {
  return Object.keys(SETTINGS_GROUP_LABELS).filter(key => JSON.stringify(current[key]) !== JSON.stringify(saved[key]));
}
