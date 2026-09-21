import fs from "fs";
import path from "path";
import { db } from "./db";
import { logApp } from "./logs";

/* Database backups.
   SQLite (dev / single-VPS installs): VACUUM INTO makes a consistent copy of a live database
   in one statement — safer than copying the file, which can catch a half-written WAL.
   PostgreSQL (production, when DATABASE_URL is a postgres URL): pg_dump, and if the binary is
   not on the machine we say so instead of pretending a backup happened.
   Files live in ./backups (git-ignored) and the screen lists them with real sizes and dates. */

export const BACKUP_DIR = path.join(process.cwd(), "backups");

export function isPg(): boolean {
  return (process.env.DATABASE_URL || "").startsWith("postgres");
}

export type BackupFile = { name: string; size: number; at: string };

export function listBackups(): BackupFile[] {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^backup-.*\.(sqlite|sql|db)$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch {
    return [];
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

export async function createBackup(kind = "manual"): Promise<{ ok: boolean; name?: string; size?: number; error?: string }> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (isPg()) {
      const name = `backup-${stamp()}-${kind}.sql`;
      const { execFileSync } = await import("child_process");
      try {
        const out = execFileSync("pg_dump", ["--no-owner", "--no-acl", process.env.DATABASE_URL!], { maxBuffer: 512 * 1024 * 1024 });
        fs.writeFileSync(path.join(BACKUP_DIR, name), new Uint8Array(out));
      } catch (e: any) {
        const error = /ENOENT/.test(String(e?.message)) ? "pg_dump is not installed on this server" : String(e?.message || e).slice(0, 200);
        await logApp("ERROR", "BACKUP", "postgres backup failed: " + error);
        return { ok: false, error };
      }
      const size = fs.statSync(path.join(BACKUP_DIR, name)).size;
      await logApp("INFO", "BACKUP", `${kind} backup written (${name})`, { size });
      return { ok: true, name, size };
    }
    // SQLite: one consistent snapshot of the live database
    const name = `backup-${stamp()}-${kind}.sqlite`;
    const file = path.join(BACKUP_DIR, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const size = fs.statSync(file).size;
    await logApp("INFO", "BACKUP", `${kind} backup written (${name})`, { size });
    return { ok: true, name, size };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 200);
    await logApp("ERROR", "BACKUP", "backup failed: " + error);
    return { ok: false, error };
  }
}

/** Keep the newest `keep` files, drop the rest. */
export async function pruneBackups(keep = 14): Promise<number> {
  const files = listBackups();
  let removed = 0;
  for (const f of files.slice(keep)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); removed++; } catch {}
  }
  if (removed) await logApp("INFO", "BACKUP", `pruned ${removed} old backup(s), kept ${keep}`);
  return removed;
}

/** SQLite only: put a snapshot back. A pre-restore copy is always taken first, so a wrong
    pick can be undone. The database file is replaced while the app keeps running, which is
    exactly why the safety copy matters. */
export async function restoreBackup(name: string): Promise<{ ok: boolean; error?: string; safety?: string }> {
  const file = path.join(BACKUP_DIR, path.basename(name));
  if (!fs.existsSync(file)) return { ok: false, error: "Backup not found" };
  if (isPg()) return { ok: false, error: "Restoring PostgreSQL is done with psql on the server: psql \"$DATABASE_URL\" < " + file };
  const safety = await createBackup("pre-restore");
  try {
    const target = path.join(process.cwd(), "prisma", "dev.db");
    fs.copyFileSync(file, target);
    try { fs.rmSync(target + "-wal", { force: true }); fs.rmSync(target + "-shm", { force: true }); } catch {}
    await logApp("WARN", "BACKUP", `database restored from ${path.basename(file)}`, { safety: safety.name });
    return { ok: true, safety: safety.name };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 200);
    await logApp("ERROR", "BACKUP", "restore failed: " + error);
    return { ok: false, error };
  }
}
