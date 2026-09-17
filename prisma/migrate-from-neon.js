/*
 * Copy the SINZO database from Neon into the VPS Postgres — WITHOUT root, WITHOUT pg_dump.
 *
 * Why this file exists, and why it lives in prisma/ (not scripts/): the production image copies `.next`,
 * node_modules, public, package.json, prisma and next.config.mjs — but NOT scripts/ (see Dockerfile), so a
 * helper placed in scripts/ cannot be run inside the container. prisma/ IS in the image, so this is reachable
 * at /app/prisma/migrate-from-neon.js from Dokploy → your compose service → Console. No docker, no SSH, no
 * host shell, and no credential typed anywhere: the container already has the Neon URL in its own env.
 *
 *   node prisma/migrate-from-neon.js --dry                                  # counts only, writes nothing
 *   node prisma/migrate-from-neon.js                                        # first full copy (app may stay LIVE)
 *   node prisma/migrate-from-neon.js --only=Order,OrderItem --truncate      # final delta, app stopped
 *   node prisma/migrate-from-neon.js --verify-only                          # re-check after the cutover
 *
 *   SRC_URL  defaults to the app's own DATABASE_URL (the Neon string)
 *   DST_URL  the VPS database: postgresql://sinzo:<PW>@db:5432/sinzo
 *            PW: open the *db* service's Console in the same panel → printenv POSTGRES_PASSWORD
 *
 * Neon is only ever READ (SELECT), so that copy stays intact as the rollback.
 *
 * Raw SQL both directions on purpose. Prisma's createMany would rewrite every @updatedAt, re-validate rows
 * that are already authoritative, and be slower; INSERT ... ON CONFLICT DO NOTHING keeps ids, timestamps and
 * image bytes identical and makes a re-run harmless. Sequences are then advanced explicitly, because that is
 * the one thing a hand-rolled copy forgets and it fails as a duplicate-key error on the first new order.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const LIST = (n) => val(n, "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);   // accepts "A,B" and "A B"

// normal copy: source = the app's own DATABASE_URL (Neon), target = DST_URL (the VPS database).
// --verify-only: source = DATABASE_URL_OLD (Neon), target = DATABASE_URL (the VPS one the app now uses), so the
// same file is the post-cutover drift check without re-pointing anything by hand.
const VERIFY = argv.includes("--verify-only");
/* ------------------------------------------------------------------ boot mode (no terminal, no SSH)
 * Dokploy's Compose panel lets you add environment variables and click Deploy. The image CMD runs this file
 * before it starts the app, so the whole move is two panel edits and zero typing. MIGRATE_ON_BOOT values:
 *
 *   full   — copy everything from the app's current DATABASE_URL (Neon) into the VPS database. The app keeps
 *            serving Neon during this; nothing on the source is modified, nothing is truncated on the target.
 *   cutover — one-shot: copy the busy tables Neon → VPS, and ONLY if that verifies, hand the app the VPS URL
 *            for this process (the entrypoint reads MIGRATE_MARKER and exports DATABASE_URL). One panel line,
 *            no second edit. Re-booting with the marker present SKIPS the copy — that is deliberate, see below.
 *   final  — the last delta, run from the deploy that ALREADY has DATABASE_URL = the VPS database: it copies
 *            the busy tables from MIGRATE_SRC_URL (Neon) into the live target and re-checks. It runs before
 *            `npm run start`, i.e. before the port is bound, so the shop cannot accept an order mid-copy and
 *            there is no gap to paper over. Media is skipped for speed (set MIGRATE_FINAL_MEDIA=1 to include).
 *
 * In boot mode this file can NEVER stop the shop: every failure is logged loudly and the process exits 0 so
 * the CMD continues. If a boot ever looks stuck, it is this — check the panel's Logs, not the app.
 */
const BOOT = (process.env.MIGRATE_ON_BOOT || "").trim().toLowerCase();
const IS_BOOT = BOOT && BOOT !== "0" && BOOT !== "off" && BOOT !== "false";
const FINAL = BOOT === "final" || BOOT === "delta";
const CUTOVER = BOOT === "cutover";
const DELTA = FINAL || CUTOVER;                       // any mode that truncates: needs the newer-target guard
const MARKER = process.env.MIGRATE_MARKER || "/tmp/sinzo-cutover.url";
const FINAL_SET = "Order OrderItem Customer Product ProductVariant Coupon Review InventoryMovement AbandonedCheckout PushSubscription";
// "the same database twice" = same host AND same database name. Host alone is not enough: on a test box both
// ends are 127.0.0.1 with different db names, and refusing that would be a false alarm.
const endpointOf = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port}/${x.pathname}`; } catch { return ""; } };

function deriveVpsUrl() {
  const host = process.env.MIGRATE_DB_HOST || "db";
  const port = process.env.MIGRATE_DB_PORT || "5432";
  const user = process.env.MIGRATE_DB_USER || "sinzo";
  const name = process.env.MIGRATE_DB_NAME || "sinzo";
  const pw = process.env.POSTGRES_PASSWORD || "";
  if (!pw) return "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@${host}:${port}/${name}`;
}

let SRC = process.env.SRC_URL || (process.env.MIGRATE_SRC_URL || "") ||
          (VERIFY ? process.env.DATABASE_URL_OLD : process.env.DATABASE_URL) || "";
let DST = process.env.DST_URL || (VERIFY ? process.env.DATABASE_URL : "") || "";
if (IS_BOOT) {
  if (FINAL) { SRC = process.env.MIGRATE_SRC_URL || process.env.DATABASE_URL_OLD || ""; DST = process.env.DATABASE_URL || ""; }
  else { DST = process.env.MIGRATE_DST_URL || deriveVpsUrl(); }   // full/cutover: DATABASE_URL is still Neon
  argv.push("--page=" + (process.env.MIGRATE_PAGE || "400"));
  if (FINAL) {
    argv.push("--only=" + (process.env.MIGRATE_ONLY || FINAL_SET));
    argv.push("--truncate");                       // the app is not serving yet, so a truncate set is safe
    if (!process.env.MIGRATE_FINAL_MEDIA) argv.push("--skip=Media");   // ~100 MB of pictures would add minutes
  } else if (CUTOVER) {
    // NO --only here: the target may be empty, and a busy-tables-only copy would boot the app on a database
    // missing Media/Setting/etc. Truncate everything and copy everything — it runs while the deploy is
    // restarting the container anyway, so it is not extra downtime.
    argv.push("--truncate");
  }
}
const PAGE = Number(val("page", 400));
const BYTES_PAGE = Number(val("bytes-page", 12));   // bytea rows are ~0.5 MB each; small pages keep the heap sane
const DRY = flag("dry");
const ONLY = LIST("only");
const SKIP = new Set(LIST("skip").concat(flag("no-media") ? ["Media"] : []));
const TRUNCATE = flag("truncate") || ONLY.length > 0;   // a partial copy is always truncate-and-replace

const client = (url) => new PrismaClient({ datasources: { db: { url } }, log: [] });
const mask = (s) => String(s).replace(/(\/\/[^:/@]+:)[^@]+@/g, "$1•••@");
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
// SQL literals for names that came out of pg_catalog (never from an argument). They are inlined rather than
// bound because pg_get_serial_sequence($1,$2) makes Postgres error with "could not determine the data type
// of parameter $1", and a .catch() around that once reported "21 sequences advanced" from a null result.
const lit = (x) => `'${String(x).replace(/'/g, "''")}'`;
const idLit = (x) => lit(`public.${q(x)}`);          // → 'public."Order"' (regclass input)
const one = async (db, sql, ...p) => (await db.$queryRawUnsafe(sql, ...p))[0];
const num = async (db, sql, ...p) => Number((await one(db, sql, ...p)).n);
const die = (m) => {
  if (IS_BOOT) {
    console.log("\n[migrate] refusing to continue: " + String(m).replace(/\n/g, "\n[migrate] "));
    console.log("[migrate] nothing was written, and the app starts anyway — this helper never takes the shop down.");
    console.log("[migrate] paste this whole log to whoever is helping you.");
    process.exit(0);
  }
  console.error("\n✗ " + m + "\n"); process.exit(1);
};
const say = (m) => console.log("\n▸ " + m);
const warn = (m) => console.log("\n! " + m);
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => console.log("  FAIL " + m);
const src = client(SRC);
let dst = null;

// How far the sequence sits ahead of the data. pg_sequences.last_value is NULL right after
// setval(..., is_called=false) — exactly the state this script leaves every sequence in — so that view cannot
// prove the fix took. SELECTing from the sequence itself reads it without advancing it (nextval would burn an
// id). Returns null when the column has no sequence (cuid pk / composite pk).
async function seqGap(db, table, col) {
  const r = await one(db, `SELECT pg_get_serial_sequence(${idLit(table)}, ${lit(col)}) AS s`);
  if (!r || !r.s) return null;
  const v = await one(db, `SELECT last_value::bigint AS n, is_called FROM ${r.s}`);
  if (!v) return null;
  const nextIsThis = Number(v.n) + (v.is_called ? 1 : 0);
  const mx = await num(db, `SELECT COALESCE(MAX(${q(col)}),0)::bigint AS n FROM ${q(table)}`);
  return { seq: r.s, gap: nextIsThis - mx, next: nextIsThis, max: mx };
}

async function main() {
  if (IS_BOOT) {
    console.log(`[migrate] MIGRATE_ON_BOOT=${BOOT} — ${FINAL ? "final delta before the app accepts traffic" : "full copy while the shop still runs on the other database"}`);
    console.log(`[migrate] source=${mask(SRC)} target=${mask(DST)}`);
    if (SRC && DST && endpointOf(SRC) === endpointOf(DST))
      return console.log("[migrate] ABORTED: source and target are on the same host. Nothing was touched.");
  }
  if (CUTOVER && require("fs").existsSync(MARKER)) {
    // The flip already happened. Re-copying now would TRUNCATE the VPS tables and write OLDER Neon rows over
    // orders the shop has taken since — so this marker is the reason a restart with the flag left in place is
    // harmless. Delete MIGRATE_ON_BOOT once DATABASE_URL in the panel points at the VPS database.
    console.log(`[migrate] ${MARKER} exists — the cutover already ran on this container; skipping the copy and`);
    console.log(`[migrate] letting the entrypoint start the app on ${mask(require("fs").readFileSync(MARKER, "utf8").trim())}.`);
    return;
  }
  if (!SRC) die("no source URL — inside the app container DATABASE_URL is the Neon string, so this should be automatic.");
  if (IS_BOOT && !DST && !FINAL)
    die(`could not work out the VPS database URL on its own.
   The app container needs POSTGRES_PASSWORD in its environment to build it (MIGRATE_DB_HOST=db,
   MIGRATE_DB_USER=sinzo, MIGRATE_DB_NAME=sinzo are already the defaults). Fix it by adding ONE line to
   the Dokploy env, then Deploy again:
     MIGRATE_DST_URL=postgresql://sinzo:<the db service's POSTGRES_PASSWORD>@db:5432/sinzo`);
  if (!DST) die(`DST_URL is required, e.g.
   DST_URL='postgresql://sinzo:<PW>@db:5432/sinzo' node prisma/migrate-from-neon.js
<PW> comes from the *db* service's Console in the same panel:  printenv POSTGRES_PASSWORD
(--verify-only is the exception: run it with DATABASE_URL already pointing at the VPS.)`);
  dst = client(DST);
  console.log(`source  ${mask(SRC)}\ntarget  ${DST ? mask(DST) : "(same client — verify only)"}`);

  /* ------------------------------------------------- structure, read off the source (authoritative) */
  const tables = (await src.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).map((r) => r.tablename);
  if (!tables.length) die("the source has no tables — wrong database?");
  // every PK column, in index order: CollectionProduct has a COMPOSITE pk, and paging by just its first
  // column would silently skip rows that share it.
  // relname, never ::regclass::text — regclass renders "Order" with quotes for our case-sensitive names, and a
  // map keyed that way silently finds nothing, which turns into "copied 3 of 7 rows and said ok".
  const pkCols = {};
  for (const r of await src.$queryRawUnsafe(
    `SELECT pc.relname AS t, array_agg(a.attname ORDER BY k.ord) AS cols
       FROM pg_index i
       JOIN pg_class pc ON pc.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = pc.relnamespace
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indisprimary AND n.nspname='public' GROUP BY 1`)) pkCols[r.t] = r.cols;
  const cols = {}, colType = {};
  for (const r of await src.$queryRawUnsafe(
    `SELECT table_name AS t, column_name AS col, data_type AS ty FROM information_schema.columns
      WHERE table_schema='public' ORDER BY table_name, ordinal_position`)) {
    (cols[r.t] = cols[r.t] || []).push(r.col); (colType[r.t] = colType[r.t] || {})[r.col] = r.ty;
  }
  const bytea = new Set((await src.$queryRawUnsafe(
    `SELECT DISTINCT c.relname AS t FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type ty ON ty.oid = a.atttypid
      WHERE n.nspname='public' AND ty.typname='bytea' AND a.attnum > 0 AND NOT a.attisdropped`)).map((r) => r.t));
  const fkTotal = Number((await one(src,
    `SELECT count(*)::int AS n FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE con.contype='f' AND n.nspname='public'`)).n);
  const edges = (await src.$queryRawUnsafe(
    `SELECT DISTINCT cc.relname AS child, pc.relname AS parent
       FROM pg_constraint con
       JOIN pg_class cc ON cc.oid = con.conrelid
       JOIN pg_class pc ON pc.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = cc.relnamespace
      WHERE con.contype='f' AND con.conrelid <> con.confrelid AND n.nspname='public'`));
  if (fkTotal && !edges.length)
    die(`the source has ${fkTotal} foreign keys but none were parsed — refusing to guess a copy order`);

  /* ----------------------------------------- parents first, so no FK is inserted before its target */
  const order = [];
  const placed = new Set();
  for (let pass = 0; order.length < tables.length && pass <= tables.length; pass++) {
    for (const t of tables) {
      if (placed.has(t)) continue;
      if (edges.every((e) => !(e.child === t && !placed.has(e.parent)))) { order.push(t); placed.add(t); }
    }
  }
  for (const t of tables) if (!placed.has(t)) order.push(t);       // FK cycle: append; ON CONFLICT copes

  let want = (ONLY.length ? ONLY : tables).filter((t) => !SKIP.has(t));
  for (const t of want) if (!tables.includes(t)) die(`"${t}" is not a table on the source`);

  /* --------- TRUNCATE ... CASCADE takes children with it, so every child must be re-copied too */
  const closure = new Set(want);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) if (closure.has(e.parent) && !closure.has(e.child)) { closure.add(e.child); grew = true; }
  }
  const dragged = [...closure].filter((t) => !want.includes(t));
  want = order.filter((t) => closure.has(t));
  if (TRUNCATE && dragged.length)
    say(`auto-added to the copy because CASCADE would empty them: ${dragged.join(", ")}`);
  if (dragged.length && !TRUNCATE) die(`the tables you asked for have children (${dragged.join(", ")}); re-run with --truncate so they are copied as a set`);

  /* --------------------------------------------------------- target: schema must exist, data must not */
  const dstHas = new Set((await dst.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map((r) => r.tablename));
  if (!dstHas.size && !DRY) {
    say("target has no schema — creating it from prisma/schema.prod.prisma (db push; an empty database loses nothing)");
    const cli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
    if (!require("fs").existsSync(cli)) die(`prisma CLI not found at ${cli} — run this from /app inside the container`);
    execFileSync(process.execPath, [cli, "db", "push", "--schema", path.join(__dirname, "schema.prod.prisma"),
      "--skip-generate"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: DST } });
    dstHas.clear();
    for (const r of await dst.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)) dstHas.add(r.tablename);
    if (!dstHas.size) die("prisma db push reported success but the target still has no tables — check the output above");
    say(`target schema created: ${dstHas.size} tables`);
  }
  const missing = want.filter((t) => !dstHas.has(t));
  if (missing.length && !DRY) die(`missing on the target: ${missing.join(", ")} — schema push did not run?`);

  const counts = {};
  for (const t of tables) counts[t] = await num(src, `SELECT count(*)::bigint AS n FROM ${q(t)}`);
  let dstRows = 0;
  for (const t of [...dstHas]) dstRows += await num(dst, `SELECT count(*)::bigint AS n FROM ${q(t)}`);
  say(`source ${tables.length} tables / ${Object.values(counts).reduce((a, b) => a + b, 0)} rows · target ${dstRows} rows`);
  if (TRUNCATE && dstRows) {
    // A truncate reload is only ever valid when the source is the NEWER database. If the target has an order
    // that the source does not, we already cut over and this run would delete real, newer sales.
    const sNew = await num(src, `SELECT COALESCE(max(id),0)::bigint AS n FROM "Order"`);
    const dNew = await num(dst, `SELECT COALESCE(max(id),0)::bigint AS n FROM "Order"`);
    if (dNew > sNew) {
      if (CUTOVER) {
        // The flag is still set but the cutover clearly already happened (the panel was never edited, or this
        // container was recreated and lost /tmp's marker). Starting on Neon now would split-brain the order
        // stream, so adopt the VPS database instead of copying over it. No data is written either way.
        require("fs").writeFileSync(MARKER, DST, { mode: 0o600 });
        console.log(`[migrate] the target already holds newer orders (${dNew} vs ${sNew} on the source) — the cutover has`);
        console.log(`[migrate] already happened, so NOTHING is copied and the app starts on the VPS database.`);
        console.log(`[migrate] write the marker back for the entrypoint and finish the job: set DATABASE_URL in the`);
        console.log(`[migrate] Dokploy env to this same value, then remove MIGRATE_ON_BOOT.`);
        return;
      }
      die(`the TARGET has newer orders than the source (max id ${dNew} vs ${sNew}) — the shop has
   already been writing to the VPS database. A truncate-and-reload from Neon would DELETE those sales.
   Nothing was touched. If you are sure the source is right, this is a merge, not a migration.`);
    }
  }
  if (dstRows && TRUNCATE && !VERIFY && !flag("force"))
    warn(`the target holds ${dstRows} rows. They will be REPLACED by the source. If any of those are real VPS
   orders, stop: they must be merged, not overwritten (deploy/NEON-TO-VPS.md §2b). --force silences this.`);
  if (dstRows && !TRUNCATE && !VERIFY)
    die(`the target already holds ${dstRows} rows and --truncate was not passed. Nothing was touched. That is
   deliberate: an append into a half-used database is how you get duplicate orders. Either point DST_URL at a
   fresh empty database, or decide about those rows first.`);

  if (DRY) {
    say("dry run — this is what would be copied, in dependency order");
    for (const t of want) console.log(`  ${t.padEnd(20)} ${String(counts[t]).padStart(7)} rows${bytea.has(t) ? "  (bytea)" : ""}`);
    console.log("\n  nothing was written");
    return;
  }

  /* ------------------------------------------------------------------------ copy */
  if (TRUNCATE) {
    say(`emptying ${want.length} table(s) on the target, then refilling from the source`);
    await dst.$executeRawUnsafe(`TRUNCATE ${want.map((t) => q(t)).join(", ")} RESTART IDENTITY CASCADE`);
  }
  for (const t of want) {
    const pks = pkCols[t] || [];
    const size = bytea.has(t) ? BYTES_PAGE : PAGE;
    const names = cols[t];
    const tup = `(${pks.map(q).join(",")})`;
    let cursor = null, rows = 0, t0 = Date.now();
    for (;;) {
      let sql = `SELECT * FROM ${q(t)}`;
      let params = [];
      if (!pks.length) sql += ` LIMIT ${size}`;                      // no pk at all: single page (nothing here does)
      else if (cursor) {                                             // page 2+: keyset on the whole pk, so a
        sql += ` WHERE ${tup} > (${pks.map((_, i) => `$${i + 1}`).join(",")})`;   // composite pk cannot skip rows
        params = cursor;
        sql += ` ORDER BY ${pks.map(q).join(",")} ASC LIMIT ${size}`;
      } else sql += ` ORDER BY ${pks.map(q).join(",")} ASC LIMIT ${size}`;
      const chunk = await src.$queryRawUnsafe(sql, ...params);
      if (!chunk.length) break;
      const ph = chunk.map((_, i) => `(${names.map((_, j) => `$${i * names.length + j + 1}`).join(",")})`).join(",");
      const vals = [];
      for (const r of chunk) for (const n of names) vals.push(r[n] === undefined ? null : r[n]);
      await dst.$executeRawUnsafe(`INSERT INTO ${q(t)} (${names.map(q).join(",")}) VALUES ${ph} ON CONFLICT DO NOTHING`, ...vals);
      rows += chunk.length;
      if (!pks.length || chunk.length < size) break;
      const last = chunk[chunk.length - 1];
      cursor = pks.map((k) => last[k]);
      if (counts[t] > 2000) process.stdout.write(`     ${t}: ${rows}/${counts[t]} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
    }
    // An under-copy is a failure, never a note. The live source can only have GROWN while we read it,
    // so anything other than "target now has at least what the source had" means a paging bug.
    const now = await num(dst, `SELECT count(*)::bigint AS n FROM ${q(t)}`);
    if (now < counts[t]) die(`${t}: copied ${rows}, target holds ${now}, source had ${counts[t]} — a paging/keyset
   bug, not a live-write race. Nothing has been flipped; report this before trying again.`);
    ok(`${t.padEnd(20)} ${String(now).padStart(7)} rows${now > counts[t] ? `  (+${now - counts[t]} written on the source while copying)` : ""}`);
  }

  /* ------------------------------------------------- sequences: the part that bites at checkout */
  say("advancing sequences past max(id) — skip this and the first new order hits P2002");
  let seqs = 0;
  for (const t of want) {
    const pks = pkCols[t] || [];
    if (pks.length !== 1) continue;                                  // composite/none: no single sequence to trust
    const id = pks[0];
    // only an integer pk has a sequence to advance; Media's cuid would make MAX(id) text and error out
    if (!/int/i.test((colType[t] || {})[id] || "")) continue;
    const mx = await num(dst, `SELECT COALESCE(MAX(${q(id)}),0)::bigint AS n FROM ${q(t)}`);
    if (!Number.isFinite(mx) || mx < 0) die(`${t}.${id}: MAX(${id}) came back as "${mx}" — refusing to guess a
   sequence value, because a wrong one shows up later as a duplicate-key error on the first real order`);
    // quote_ident both parts, or a mixed-case table name is folded to lowercase and never found
    const s = await one(dst,
      `SELECT pg_get_serial_sequence(${idLit(t)}, ${lit(id)}) AS s`);
    if (!s || !s.s) continue;                                        // cuid/composite pk: no sequence to set
    await dst.$executeRawUnsafe(`SELECT setval(${lit(s.s)}::regclass, ${Math.max(mx + 1, 1)}, false)`);
    seqs++;
  }
  ok(`${seqs} sequence(s) now point at max+1 (is_called=false, so the next id is exactly max+1)`);

  /* ---------------------------------------------------------------------- verify */
  say("verify — exact counts, money, and the sequence that hands out order ids");
  let drift = 0;
  for (const t of want) {
    const a = await num(src, `SELECT count(*)::bigint AS n FROM ${q(t)}`);
    const b = await num(dst, `SELECT count(*)::bigint AS n FROM ${q(t)}`);
    if (a === b) ok(`${t.padEnd(20)} ${String(a).padStart(7)}`);
    else { bad(`${t.padEnd(20)} src=${a} dst=${b}`); drift++; }
  }
  if (want.includes("Order")) {
    for (const expr of ["sum(total)", "max(id)", `max("createdAt")::text`]) {
      const a = (await one(src, `SELECT coalesce((${expr})::text,'-') AS v FROM "Order"`)).v;
      const b = (await one(dst, `SELECT coalesce((${expr})::text,'-') AS v FROM "Order"`)).v;
      if (a === b) ok(`Order.${expr} = ${a}`); else { bad(`Order.${expr} src=${a} dst=${b}`); drift++; }
    }
    const g = await seqGap(dst, "Order", "id");
    if (g && g.gap >= 1) ok(`Order_id_seq next id = ${g.next}, max(id) = ${g.max} → a new order cannot collide`);
    else { bad(`Order_id_seq state: ${JSON.stringify(g)} — the sequence is not ahead of max(id); new orders would collide`); drift++; }
  }
  if (drift) die(`${drift} mismatch(es) — do NOT point the app at this database yet. Paste the output above.`);
  if (CUTOVER) {
    require("fs").writeFileSync(MARKER, DST, { mode: 0o600 });
    console.log(`
[migrate] DONE — verify clean, so this container now runs on the VPS database: the entrypoint exports
[migrate] DATABASE_URL from ${MARKER} for the app process. Neon was only read.
[migrate] FINISH IT: in Dokploy set DATABASE_URL to the same VPS value (or delete the override so the compose
[migrate] file's own line applies) and remove MIGRATE_ON_BOOT — until you do, every restart keeps the marker
[migrate] and skips the copy, which is safe but not permanent.`);
  } else if (FINAL) {
    console.log(`
[migrate] DONE — the app is now reading the VPS database, and the last ${want.length} table(s) were refreshed
[migrate] from Neon just before it started, so no order can have slipped through the gap.
[migrate] housekeeping: remove MIGRATE_ON_BOOT from the Dokploy env (otherwise this delta runs on every deploy),
[migrate] then place one COD test order — its id must be higher than every id above, never one that exists.
[migrate] Neon stays untouched as the rollback; pause it after 7–14 days, do not delete it.`);
  } else {
    console.log(`
▸ verify clean. Next: in Dokploy set the app service env
    DATABASE_URL   = ${mask(DST || "postgresql://sinzo:<PW>@db:5432/sinzo")}
    DEPLOY_CHANNEL = vps
  then RESTART (a restart is enough — DATABASE_URL is server-side, no rebuild needed), and place one COD test
  order: its id must be the old max +1. Keep Neon untouched and paused-later: that is the rollback.`);
  }
}

const bye = () => [src, dst].forEach((x) => x && x.$disconnect().catch(() => {}));
const bootDie = (msg) => {
  console.log("\n[migrate] " + msg);
  console.log("[migrate] the app will start anyway — this helper never takes the shop down.");
  console.log("[migrate] paste this whole log to whoever is helping you. Nothing else was changed.");
  bye(); process.exit(0);
};

main()
  .then(bye)
  .catch(async (e) => {
    const m = (e && e.message ? e.message : String(e)).slice(0, 1500);
    if (IS_BOOT) bootDie("FAILED: " + m);
    warn(m); bye(); process.exit(1);
  });
