import crypto from "crypto";

const IS_PROD = process.env.NODE_ENV === "production";
const DEV_SECRET = "dev-secret-change-me";

/* All session types use the same safe secret resolution. In particular, customer
   sessions must not fall back to a publicly known key in production. Store the
   emergency key on globalThis so reloads/module bundles in one process agree. */
function resolveSecret(): string {
  const configured = process.env.SESSION_SECRET || "";
  const placeholder = [DEV_SECRET, "generate-a-long-random-string", "change-me"].includes(configured);
  if (configured && !placeholder) return configured;
  if (!IS_PROD) return DEV_SECRET;
  const runtime = globalThis as typeof globalThis & { __sinzoSessionSecret?: string };
  if (!runtime.__sinzoSessionSecret) {
    runtime.__sinzoSessionSecret = crypto.randomBytes(32).toString("hex");
    console.error("[auth] SESSION_SECRET is missing or a placeholder. Using a random per-process key; configure SESSION_SECRET before deployment.");
  }
  return runtime.__sinzoSessionSecret;
}

export const SESSION_SECRET = resolveSecret();
export const ALLOW_URL_TOKEN = process.env.AUTH_URL_TOKEN
  ? process.env.AUTH_URL_TOKEN === "1"
  : !IS_PROD;

export function signSessionPayload(payloadB64: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
}

export function encodeSessionPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + signSessionPayload(body);
}

/* Signature validity is necessary, but NOT sufficient: callers must also check
   the payload's purpose and shape (admin, customer, or second-factor ticket). */
export function decodeSessionPayload(token?: string | null): Record<string, any> | null {
  if (typeof token !== "string" || token.length > 16_384) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  try {
    const expected = signSessionPayload(body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(new TextEncoder().encode(sig), new TextEncoder().encode(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function cookieToken(req: Request, names: string[]): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const name of names) {
    for (const part of raw.split(";")) {
      const entry = part.trim();
      if (!entry.startsWith(name + "=")) continue;
      try { return decodeURIComponent(entry.slice(name.length + 1)) || null; } catch { return null; }
    }
  }
  return null;
}
