export function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "0.0.0.0";
}
export function detectSource(attr: any): string {
  const a = attr || {};
  const utm = (a.utm_source || "").toLowerCase();
  if (a.fbclid || a.fbp || a.fbc || utm.includes("facebook")) return "Facebook";
  if (utm.includes("instagram")) return "Instagram";
  if (utm.includes("google") || utm.includes("ads")) return "Google";
  if (utm) return utm;
  const ref = (a.referrer || "").toLowerCase();
  if (ref.includes("facebook") || ref.includes("fb.")) return "Facebook";
  if (ref.includes("instagram")) return "Instagram";
  if (ref.includes("google")) return "Organic";
  if (ref) return "Referral";
  return "Direct";
}
