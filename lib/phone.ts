/* Normalize BD phone numbers to 11-digit format (01XXXXXXXXX).
   Accepts: 01676450711, +8801676450711, 8801676450711, 01676-450711 */
export function normalizeBDPhone(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, "");
  // +880 or 880 prefix → strip to get 01XXXXXXXXX
  if (digits.startsWith("880")) digits = digits.slice(3);
  // Must start with 01
  return digits.startsWith("01") ? digits : digits;
}
export function isValidBDPhone(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(phone);
}
