import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseOrderCode } from "@/lib/slug";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { code, phone } = await req.json();
    const id = parseOrderCode(code || "");
    if (id == null || !phone) return NextResponse.json({ error: "Order not found. Check your code and phone number." }, { status: 404 });
    const order = await db.order.findFirst({
      where: { id, phone: String(phone).replace(/[\s-]/g, "") },
      select: { code: true, status: true, total: true, createdAt: true, courierName: true, courierStatus: true, courierConsignmentId: true, items: { select: { title: true, qty: true } } },
    });
    if (!order) return NextResponse.json({ error: "Order not found. Check your code and phone number." }, { status: 404 });
    return NextResponse.json({ order });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
