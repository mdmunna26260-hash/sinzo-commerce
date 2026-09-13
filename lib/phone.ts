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
