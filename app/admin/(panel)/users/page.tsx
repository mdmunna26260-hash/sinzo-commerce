import { db } from "@/lib/db";
import { requireAdmin, ROLE_PERMS } from "@/lib/auth";
import UsersClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };
export default async function UsersPage({ searchParams }: { searchParams: any }) {
  const me = await requireAdmin(searchParams);
  const users = await db.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, createdAt: true }, orderBy: { id: "asc" } });
  return <UsersClient initial={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))} meId={me?.id} perms={ROLE_PERMS} />;
}
