import { NextResponse } from "next/server";
import { getSessionUser, can, verifySessionToken, tokenFromRequest, SessionUser } from "./auth";

// Accepts session via httpOnly cookie (production) OR Bearer/?t= token (preview fallback).
export async function requirePerm(perm: string | null, req?: Request): Promise<{ user: SessionUser } | { res: NextResponse }> {
  let user = await getSessionUser(req);
  if (!user) {
    const t = tokenFromRequest(req);
    user = await verifySessionToken(t);
  }
  if (!user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (perm && !can(user, perm)) return { res: NextResponse.json({ error: "Forbidden — insufficient role permissions" }, { status: 403 }) };
  return { user };
}
