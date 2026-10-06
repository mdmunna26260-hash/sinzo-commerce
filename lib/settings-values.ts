const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

/* A masked nested SMTP/SMS password must not replace the real secret when the
   admin saves a different field. Arrays (homepage sections) still replace. */
export function mergeSettingsValue(current: unknown, incoming: unknown): any {
  if (!isObject(incoming)) return incoming;
  const merged: Record<string, any> = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (unsafeKeys.has(key) || (typeof value === "string" && value.startsWith("••"))) continue;
    merged[key] = isObject(value) ? mergeSettingsValue(merged[key], value) : value;
  }
  return merged;
}

const SECRET_PATHS = [
  ["courier", "apiKey"], ["courier", "secretKey"],
  ["integrations", "metaAccessToken"], ["integrations", "googleClientSecret"],
  ["notifications", "telegramBotToken"], ["notifications", "waBridgeKey"],
  ["notifications", "smtp", "pass"], ["notifications", "sms", "apiKey"],
];

export function maskAdminSettings(settings: Record<string, any>): Record<string, any> {
  const masked = JSON.parse(JSON.stringify(settings));
  // Setting also stores internal 2FA bookkeeping; it is not store configuration.
  for (const key of Object.keys(masked)) if (key.startsWith("security.")) delete masked[key];
  for (const path of SECRET_PATHS) {
    let parent = masked;
    for (const key of path.slice(0, -1)) parent = parent?.[key];
    if (!parent) continue;
    const key = path[path.length - 1];
    const value = parent[key];
    if (typeof value === "string" && value) parent[key] = value.length > 8 ? "••••••••" + value.slice(-4) : "••••••";
  }
  return masked;
}

export const SETTING_GROUPS = new Set([
  "store", "theme", "shipping", "homepage", "homeSections", "checkout", "fraud", "seo", "maintenance",
  "courier", "integrations", "notifications", "policies", "marketing", "loyalty", "reviews", "whatsapp", "links",
]);
