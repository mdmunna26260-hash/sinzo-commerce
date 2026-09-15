/* Normalize BD phone numbers to 11-digit format (01XXXXXXXXX).
   Accepts: 01676450711, +8801676450711, 8801676450711, 01676-450711 */
export function normalizeBDPhone(raw: string): string {
  let digits = String(raw).replace(/[^0-9]/g, "");
  // +880 or 880 prefix → strip country code, then restore the dropped "0"
  // so international format (+8801676450711) becomes 01676450711
  if (digits.startsWith("880")) digits = digits.slice(3);
  if (!digits.startsWith("01") && /^1[3-9]\d{8}$/.test(digits)) digits = "0" + digits;
  return digits;
}
export function isValidBDPhone(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(phone);
}

/* wa.me requires the country code WITHOUT "+" and WITHOUT the leading 0.
   "01576450711" (what admin settings usually contains) opens WhatsApp with an
   "invalid number" error, so every wa.me/tel link goes through here. */
export function waLink(raw: string): string {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (!d) return "#";
  if (d.startsWith("880")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^1[3-9]\d{8}$/.test(d)) return "https://wa.me/" + String(raw).replace(/[^0-9+]/g, "").replace(/^\+/, "");
  return "https://wa.me/880" + d;
}
export function telLink(raw: string): string {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (!d) return "#";
  if (d.startsWith("880")) return "tel:+" + d;
  if (d.startsWith("0")) d = d.slice(1);
  return /^1[3-9]\d{8}$/.test(d) ? "tel:+880" + d : "tel:" + String(raw).replace(/[^0-9+]/g, "");
}
