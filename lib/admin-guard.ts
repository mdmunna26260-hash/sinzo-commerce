import { NextResponse } from "next/server";
import { getSessionUser, can, verifyToken, tokenFromRequest, SessionUser } from "./auth";

// Accepts session via httpOnly cookie (production) OR Bearer/?t= token (preview fallback).
export async function requirePerm(perm: string, req?: Request): Promise<{ user: SessionUser } | { res: NextResponse }> {
  let user = await getSessionUser();
  if (!user) {
    const t = tokenFromRequest(req);
    user = verifyToken(t);
  }
  if (!user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(user, perm)) return { res: NextResponse.json({ error: "Forbidden — insufficient role permissions" }, { status: 403 }) };
  return { user };
}
