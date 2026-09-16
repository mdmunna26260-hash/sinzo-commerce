/* Reset (or first-time set) an admin panel password without re-running the whole seed.
 *
 *   node scripts/set-admin-password.js 'NewPass123!'                 # Sinzo.bd@gmail.com
 *   ADMIN_EMAIL=ops@sinzoffcial.com node scripts/set-admin-password.js 'NewPass123!'
 *   npm run admin:passwd -- 'NewPass123!'
 *
 * On the VPS: docker compose exec -e ADMIN_EMAIL=... app node scripts/set-admin-password.js 'NewPass123!'
 * (.env.local is read automatically when DATABASE_URL is not already in the environment.)
 *
 * Why this exists: prisma/seed.js only does upsert:{}, so re-seeding never changes an
 * existing admin password — the usual reason an owner ends up locked out of /admin after
 * a fresh deploy. This script hashes with bcrypt(10) exactly like the login route expects
 * and creates the account if it is missing. Password is taken from argv or
 * ADMIN_NEW_PASS so it never has to sit in shell history as a named flag.
 */
const fs = require("fs");
const path = require("path");
// Plain `node` does not read Next's .env.local, so without this the script dies with
// "Environment variable not found: DATABASE_URL" on a dev checkout. Fill only what is unset.
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, "..", f), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const email = (process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "Sinzo.bd@gmail.com").toLowerCase().trim();
const pass = process.argv[2] || process.env.ADMIN_NEW_PASS || "";

(async () => {
  try {
    if (!pass) {
      console.error("usage: node scripts/set-admin-password.js '<new password>'   (or set ADMIN_NEW_PASS)");
      process.exitCode = 2;
      return;
    }
    if (pass.length < 10) {
      console.error(`refusing: password is ${pass.length} chars — 10 minimum (the panel is publicly reachable).`);
      process.exitCode = 2;
      return;
    }
    const hash = await bcrypt.hash(pass, 10);
    // Match the way /api/admin/login looks users up: exact email first, then a
    // case-insensitive pass over active admins. Without the fallback a row stored as
    // "Sinzo.bd@gmail.com" is invisible and this script silently creates a second admin.
    let existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const all = await prisma.user.findMany({ where: { active: true } });
      existing = all.find((u) => u.email.toLowerCase() === email) || null;
    }
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { password: hash, active: true } });
      console.log(`[set-admin-password] updated password for ${existing.email} (role ${existing.role}, id ${existing.id}).`);
    } else {
      const u = await prisma.user.create({
        data: { email, password: hash, name: process.env.ADMIN_NAME || "Super Admin", role: process.env.ADMIN_ROLE || "SUPER_ADMIN" },
      });
      console.log(`[set-admin-password] no admin row for ${email} — created id ${u.id} with role ${u.role}.`);
    }
    // Prove it: a compare() right here uses the same code path /api/admin/login takes.
    const row = existing || (await prisma.user.findUnique({ where: { email } }));
    const check = await prisma.user.findUnique({ where: { id: row.id }, select: { password: true } });
    console.log(`[set-admin-password] verify: bcrypt.compare → ${await bcrypt.compare(pass, check.password) ? "OK, login will work" : "BROKEN — hash mismatch"}`);
    console.log("[set-admin-password] no password is echoed anywhere — safe to run over ssh.");
  } catch (e) {
    console.error("[set-admin-password] failed:", e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
