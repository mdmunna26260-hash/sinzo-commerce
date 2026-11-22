/* The login API only hands a token to JavaScript in dev/preview or when the
   operator explicitly enables AUTH_URL_TOKEN. Preserve that fallback even if
   a cookie probe succeeds: an embedded browser can handle cookies differently
   on fetches and navigations. Production's default remains httpOnly-cookie-only. */
export async function adminLoginDestination(
  token: unknown,
  verify: (token?: string) => Promise<boolean>,
): Promise<string> {
  const fallback = typeof token === "string" && token ? token : undefined;
  if (!await verify(fallback)) {
    throw new Error("Your browser could not keep the admin session. Open the preview in a new tab and sign in again.");
  }
  return fallback ? "/admin/dashboard?t=" + encodeURIComponent(fallback) : "/admin/dashboard";
}

/* Preview proxies can consume Authorization themselves. Only use a URL fallback
   when the login API explicitly supplied a token (never in cookie-only login). */
export function adminSessionProbeUrl(token?: string): string {
  return token ? "/api/admin/whoami?t=" + encodeURIComponent(token) : "/api/admin/whoami";
}
