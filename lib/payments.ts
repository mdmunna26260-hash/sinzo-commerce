import { db } from "./db";

/* Advance / due payment tracking (admin menu item 6).
   A COD shop still takes money before delivery (bKash advance, partial payment) and pays money
   back out (refund). Each movement is a `Payment` row — never a silent edit of the order total —
   so the ledger can always be reconciled against the cash the courier hands over. */

export const PAYMENT_KINDS = [
  { id: "ADVANCE", label: "Advance", hint: "taken before dispatch" },
  { id: "DUE", label: "Collected at delivery", hint: "the rider handed the cash in" },
  { id: "REFUND", label: "Refund", hint: "money went back to the customer" },
] as const;

export const PAYMENT_METHODS = ["bkash", "nagad", "rocket", "bank", "cash", "other"] as const;

export type PaymentRow = {
  id: number;
  orderId: number;
  amount: number;
  kind: string;
  method: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: Date;
};

export type Summary = {
  total: number;
  /** money the customer handed over before dispatch */
  advance: number;
  /** money collected on delivery */
  collected: number;
  refunded: number;
  /** everything received, minus what was refunded — the real "in hand" figure */
  net: number;
  /** still to collect (never negative) */
  balance: number;
  /** the customer paid too much — this much is owed back */
  credit: number;
  rows: number;
  state: "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Turn a list of money movements into the numbers the admin actually asks for. */
export function summarize(total: number, rows: PaymentRow[] = []): Summary {
  let advance = 0, collected = 0, refunded = 0;
  for (const r of rows) {
    const amt = round(Number(r.amount) || 0);
    if (r.kind === "REFUND") refunded += amt;
    else if (r.kind === "DUE") collected += amt;
    else advance += amt;
  }
  const net = round(advance + collected - refunded);
  const t = round(Number(total) || 0);
  const balance = Math.max(0, round(t - net));
  const credit = Math.max(0, round(net - t));
  const state: Summary["state"] = net <= 0 ? "UNPAID" : credit > 0 ? "OVERPAID" : balance > 0 ? "PARTIAL" : "PAID";
  return { total: t, advance, collected, refunded, net, balance, credit, rows: rows.length, state };
}

/** Pretty method name — "cash" → "Cash", "bkash" → "bKash". Pass a reference to append it. */
export function methodLabel(method: string, ref?: string | null): string {
  const m = String(method || "").toLowerCase();
  const nice = m === "bkash" ? "bKash" : m === "nagad" ? "Nagad" : m === "rocket" ? "Rocket" : m === "cod" ? "COD" : m === "bank" ? "Bank" : m === "cash" ? "Cash" : m ? m.charAt(0).toUpperCase() + m.slice(1) : "—";
  return ref ? `${nice} · ${ref}` : nice;
}

/** Everything the order screen needs in one round trip. */
export async function paymentSummary(orderId: number) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, name: true, phone: true, total: true, status: true, paymentStatus: true, paymentMethod: true, createdAt: true },
  });
  if (!order) return { order: null, rows: [] as PaymentRow[], summary: summarize(0) };
  const rows = (await db.payment.findMany({ where: { orderId }, orderBy: { id: "asc" } })) as PaymentRow[];
  return { order, rows, summary: summarize(order.total, rows) };
}

/** Payment status the rest of the admin already understands. */
export function paymentStatusFor(s: Summary): string {
  if (s.refunded > 0 && s.net <= 0) return "REFUNDED";
  if (s.net <= 0) return "PENDING";
  return s.balance <= 0.5 ? "PAID" : "PARTIAL";
}
