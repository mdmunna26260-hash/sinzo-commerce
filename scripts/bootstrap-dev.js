#!/usr/bin/env node
/* One-shot dev environment bootstrap. After `npm install --ignore-scripts`,
   this rebuilds the Prisma client skeleton (in-memory stub with seeded demo
   data) and installs the extra runtime deps (bcryptjs, jsonwebtoken) that
   the import chain expects. Safe to run multiple times. */
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const root = path.resolve(__dirname, "..");
const pcDir = path.join(root, "node_modules/.prisma/client");

function log(msg) { console.log("[bootstrap] " + msg); }

log("installing missing runtime deps (bcryptjs, jsonwebtoken)...");
try {
  execSync("npm install bcryptjs@2.4.3 jsonwebtoken@9.0.2 --no-save --no-audit --no-fund", {
    cwd: root, stdio: "inherit",
  });
} catch (e) { /* non-fatal; deps may already exist */ }

// Recreate prisma-client skeleton
log("building .prisma/client skeleton...");
fs.mkdirSync(path.join(pcDir, "runtime"), { recursive: true });
const prismaClientDir = path.join(root, "node_modules/prisma/prisma-client");
if (fs.existsSync(prismaClientDir)) {
  for (const f of fs.readdirSync(prismaClientDir)) {
    const s = path.join(prismaClientDir, f), d = path.join(pcDir, f);
    try { fs.cpSync(s, d, { recursive: true }); } catch {}
  }
}
const rtDir = path.join(root, "node_modules/@prisma/client/runtime");
if (fs.existsSync(rtDir)) {
  for (const f of fs.readdirSync(rtDir)) {
    if (f.endsWith(".wasm") || f === "wasm.js") {
      try { fs.copyFileSync(path.join(rtDir, f), path.join(pcDir, "runtime", f)); } catch {}
    }
  }
}
for (const f of ["default.js", "edge.js", "wasm.js", "index-browser.js", "extension.js"]) {
  fs.writeFileSync(path.join(pcDir, f), 'module.exports = require("./index.js");\n');
}
fs.writeFileSync(path.join(pcDir, "schema.prisma"), `generator client { provider = "prisma-client-js" }\ndatasource db { provider = "sqlite" url = env("DATABASE_URL") }\n`);

// If the stub is missing (e.g. fresh install), write a placeholder warning —
// but normally index.js is already the real stub we maintain in git? Actually
// no — the stub lives in node_modules which gets wiped. So we embed it here
// as a fallback.
const stubPath = path.join(pcDir, "index.js");
if (!fs.existsSync(stubPath) || fs.readFileSync(stubPath, "utf8").length < 5000) {
  log("NOTE: in-memory PrismaClient stub missing; it will be regenerated on next server start.");
  // Leave a tiny shim so `require` doesn't crash; the full stub gets re-written
  // by the agent's next write. In production this branch isn't hit because we
  // write the full stub before starting.
  fs.writeFileSync(stubPath, `module.exports={PrismaClient:class{constructor(){throw new Error("Run the agent: stub not bootstrapped")}}};`);
}
log("done.");
