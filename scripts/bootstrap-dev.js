#!/usr/bin/env node
/* Generate the real development Prisma client. Earlier versions overwrote it
   with an incomplete in-memory stub, hiding DB bugs and discarding real data. */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

try {
  execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "generate", "--schema", "prisma/schema.prisma"], { cwd: root, stdio: "inherit" });
  console.log("[bootstrap] real Prisma client ready. Initialize dev data with npm run db:push && npm run db:seed if needed.");
} catch {
  console.error("[bootstrap] Prisma generation failed. Check dependency installation/network access; no fake database client was installed.");
  process.exitCode = 1;
}
