export function formatMoney(amount: number, symbol = "৳"): string {
  const n = Math.round((amount || 0) * 100) / 100;
  return symbol + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
