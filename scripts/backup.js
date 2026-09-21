#!/usr/bin/env node
/* Manual / cron backup. Same logic the admin screen uses, but runnable from a shell:
     npm run backup            → snapshot, keep newest 14
     npm run backup -- --keep 30
   SQLite: VACUUM INTO (one consistent copy of a live file — safe while the shop is serving).
   PostgreSQL: pg_dump. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(process.cwd(), "backups");
const keepArg = process.argv.indexOf("--keep");
const KEEP = keepArg > -1 ? Number(process.argv[keepArg + 1]) || 14 : 14;

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const isPg = (process.env.DATABASE_URL || "").startsWith("postgres");
  let file;
  if (isPg) {
    file = path.join(DIR, `backup-${stamp}-cron.sql`);
    execFileSync("pg_dump", ["--no-owner", "--no-acl", process.env.DATABASE_URL, "-f", file], { stdio: "inherit" });
  } else {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient();
    file = path.join(DIR, `backup-${stamp}-cron.sqlite`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    await db.$disconnect();
  }
  const size = fs.statSync(file).size;
  console.log(`✓ backup: ${path.basename(file)} (${(size / 1024).toFixed(0)} KB)`);

  const files = fs.readdirSync(DIR).filter((f) => /^backup-.*\.(sqlite|sql)$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
    fs.unlinkSync(path.join(DIR, old));
    console.log(`  pruned ${old}`);
  }
}

main().catch((e) => { console.error("backup failed:", e.message); process.exit(1); });
