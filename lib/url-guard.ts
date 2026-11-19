/* Redirect-target validation.

   Short-link redirects answer a campaign click with a 302 to whatever target is
   stored. The old check was `/^https?:\/\//.test(target)` — i.e. "is it a URL",
   not "is it a URL we are willing to send our customers to". Any http(s) value passed,
   so the shop's own trusted domain became an open redirect: a phishing link that
   arrives as https://sinzooffcial.com/l/sale reads as a shop URL in the address bar of
   anyone who clicks through, and in every referrer the destination receives.

   The rule now is: same origin always, other origins only if the operator listed them.
   Relative paths stay relative (they cannot leave the site), and anything with a
   non-http scheme or a protocol-relative "//host" form is rejected outright. */

const DEFAULT_ALLOWED_HOSTS: string[] = [
  // Off-site redirect destinations are operator-listed only (REDIRECT_ALLOWLIST).
];

function allowedHosts(): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  const extra = String(process.env.REDIRECT_ALLOWLIST || "");
  for (const entry of extra.split(/[,\s]+/)) {
    const host = entry.trim().toLowerCase().replace(/^\.+/, "");
    // Accept either "example.com" or a full URL; store the bare host.
    if (!host) continue;
    try { hosts.add(new URL(host.includes("://") ? host : "https://" + host).hostname.toLowerCase()); }
    catch { hosts.add(host); }
  }
  return hosts;
}

/* Exact host match, or a subdomain of an allowed host. Never a substring match —
   "example.com.evil.com" must not pass when "example.com" is listed. */
function hostAllowed(hostname: string, allowed: Set<string>): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (allowed.has(host)) return true;
  for (const entry of allowed) {
    if (host.endsWith("." + entry)) return true;
  }
  return false;
}

export type TargetOptions = {
  /** Used to resolve relative targets into absolute ones. */
  requestUrl?: string;
  /** The shop's own origin — always permitted. Derived from requestUrl when omitted. */
  siteOrigin?: string;
  /** Permit plain relative paths ("/products/x"). Default true. */
  allowRelative?: boolean;
};

/* Return a URL that is safe to 302 to, or null when the caller should fall back. */
export function safeExternalTarget(raw: unknown, options: TargetOptions = {}): string | null {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 2048) return null;
  // NULs and control characters are the usual way to hide a scheme from a regex.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  /* Backslashes anywhere. Browsers normalise "\" to "/" in URLs, so "/\evil.com" and
     "\evil.com" both become the protocol-relative "//evil.com" — which is exactly the
     form the next check exists to reject. */
  if (value.includes("\\")) return null;

  const allowRelative = options.allowRelative !== false;

  // Protocol-relative ("//evil.example.com") parses as a URL against any base, so it
  // has to be rejected before the URL constructor ever sees it.
  if (value.startsWith("//")) return null;

  /* Only two shapes are meaningful here: a site-relative path, or an absolute URL with
     an explicit scheme. Everything else ("not a url", "products/x", "42") would be
     resolved by the URL constructor against the request base and come back looking
     same-origin — harmless, but it means junk from the database silently turns into a
     redirect instead of being refused. */
  const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
  if (value.startsWith("/")) {
    if (!allowRelative) return null;
    if (!options.requestUrl) return value;
    try { return new URL(value, options.requestUrl).toString(); } catch { return null; }
  }
  if (!ABSOLUTE_SCHEME.test(value)) return null;

  let url: URL;
  try { url = new URL(value); } catch { return null; }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (options.siteOrigin) {
    try {
      if (url.origin === new URL(options.siteOrigin).origin) return url.toString();
    } catch { /* a malformed NEXT_PUBLIC_SITE_URL must not widen the allow-list */ }
  }
  if (options.requestUrl) {
    try {
      if (url.origin === new URL(options.requestUrl).origin) return url.toString();
    } catch { /* ignore */ }
  }

  return hostAllowed(url.hostname, allowedHosts()) ? url.toString() : null;
}

/* True when a value is a same-origin path — for callers that only ever want internal
   navigation (post-login redirects, `next` parameters) and no external target at all. */
export function isSameOriginPath(raw: unknown): boolean {
  const value = String(raw ?? "");
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
