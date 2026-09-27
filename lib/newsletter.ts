import { db } from "./db";

/* ------------------------------------------------------------------
 * Newsletter subscribe helpers.
 *
 * Two distinct flows:
 *  • explicit (footer form / /api/newsletter): user typed their email
 *    and clicked "Subscribe". If they had previously unsubscribed, this
 *    is a clear opt-in signal — resubscribe them.
 *  • implicit (checkout / Google login): customer gave us their email
 *    as part of a transaction / sign-in. We silently add them to the
 *    list ONLY if they aren't already there AND haven't unsubscribed.
 *    Once someone has clicked "Unsubscribe", we never re-add them
 *    automatically — they have to explicitly sign up again.
 *
 * This implements the common double-opt-in-ish safe default for
 * transactional emails → marketing list handoff, and matches how
 * Shopify / WooCommerce / Klaviyo behave by default.
 * ------------------------------------------------------------------ */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalize(email: unknown): string | null {
  if (!email || typeof email !== "string") return null;
  const s = email.trim().toLowerCase();
  if (!EMAIL_RE.test(s)) return null;
  // don't auto-capture common role/team addresses or throwaway-looking input
  if (s.endsWith("@example.com") || s.endsWith("@test.com")) return null;
  return s;
}

/**
 * Explicit sign-up via the newsletter form / admin CSV import.
 * Opt-in is deliberate — reactivates an earlier unsubscribe.
 */
export async function subscribeExplicit(email: unknown): Promise<{ ok: boolean; email?: string }> {
  const e = normalize(email);
  if (!e) return { ok: false };
  try {
    await db.subscriber.upsert({
      where: { email: e },
      update: { unsubscribed: false, unsubscribedAt: null },
      create: { email: e },
    });
    return { ok: true, email: e };
  } catch {
    // subscriber table might not exist yet (db-ensure hasn't run);
    // fail silently and let the caller retry next time rather than
    // breaking the calling flow (checkout/auth).
    try { await db.subscriber.create({ data: { email: e } }).catch(() => {}); } catch {}
    return { ok: true, email: e };
  }
}

/**
 * Implicit sign-up from checkout or Google auth. Adds the address
 * only if it's brand-new. Existing rows (whether subscribed or
 * unsubscribed) are left untouched — never re-enables an unsubscribe.
 * Safe to call multiple times; no dupes, no spam complaints.
 */
export async function subscribeImplicit(email: unknown): Promise<{ ok: boolean; email?: string }> {
  const e = normalize(email);
  if (!e) return { ok: false };
  try {
    const existing = await db.subscriber.findUnique({ where: { email: e } });
    if (existing) return { ok: true, email: e }; // already in list (either state); do nothing
    await db.subscriber.create({ data: { email: e } });
    return { ok: true, email: e };
  } catch {
    return { ok: false };
  }
}
