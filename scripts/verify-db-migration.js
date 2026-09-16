/* Post-migration integrity check: Neon vs the VPS database, side by side.
 *
 *   SRC_URL=postgresql://…neon… DST_URL=postgresql://sinzo:…@127.0.0.1:5432/sinzo_live \
 *     node scripts/verify-db-migration.js
 *
 * Needs the PostgreSQL-flavoured client (that is what `npm run build` generates):
 *   npx prisma generate --schema prisma/schema.prod.prisma
 * Inside the app container it is already the case, so `docker compose exec app node scripts/verify-db-migration.js` just works.
 *
 * Why a second checker when deploy/neon-to-vps.sh has `verify`: this one runs through Prisma, so it
 * also works from a host with no psql/pg_dump installed, and it is what you re-run on the first
 * morning after the cutover to prove the app is writing where you think it is.
 *
 * Checks per base table: exact count. Plus money/sequence checks that a naive count comparison misses.
 * Exit code 0 = identical, 1 = drift (never cut over on 1), 2 = bad usage.
 */
const { PrismaClient } = require("@prisma/client");

const SRC = process.env.SRC_URL || process.env.DATABASE_URL_OLD || "";
const DST = process.env.DST_URL || process.env.DATABASE_URL || "";
const AS_JSON = process.argv.includes("--json");

const client = (url) => new PrismaClient({
  datasources: { db: { url } },
  log: [],
  errorFormat: "minimal",
});

// tables that legitimately drift right after a cutover (telemetry is append-only noise)
const SOFT = new Set((process.env.SOFT_TABLES || "TrackingEvent").split(/[\s,]+/).filter(Boolean));

async function tables(c) {
  const rows = await c.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '_prisma%' ORDER BY tablename`
  );
  return rows.map((r) => r.tablename);
}
const count = async (c, t) => {
  try {
    const r = await c.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM "${t}"`);
    return String(r[0]?.n ?? "?");
  } catch {
    return "ERR";
  }
};

(async () => {
  if (!SRC || !DST) {
    console.error("usage: SRC_URL=… DST_URL=… node scripts/verify-db-migration.js [--json]");
    process.exitCode = 2;
    return;
  }
  const src = client(SRC);
  const dst = client(DST);
  const out = { tables: [], checks: [], problems: [] };
  try {
    const ts = await tables(src);
    if (!ts.length) throw new Error("no tables found on SRC_URL — wrong database?");

    for (const t of ts) {
      const a = await count(src, t);
      const b = await count(dst, t);
      const same = a === b;
      const soft = SOFT.has(t);
      out.tables.push({ table: t, src: a, dst: b, ok: same || soft });
      if (!same && !soft) out.problems.push(`row count differs on "${t}": src=${a} dst=${b}`);
    }

    const num = async (c, q) => {
      try {
        const r = await c.$queryRawUnsafe(q);
        return String(Object.values(r[0] ?? {})[0] ?? "?");
      } catch {
        return "ERR";
      }
    };
    const hard = [
      ["order money total", 'SELECT coalesce(sum(total),0)::text v FROM "Order"'],
      ["order line money", 'SELECT coalesce(sum(price*qty),0)::text v FROM "OrderItem"'],
      ["latest order id", 'SELECT coalesce(max(id),0)::text v FROM "Order"'],
      ["live stock sum", 'SELECT coalesce(sum(stock),0)::text v FROM "ProductVariant"'],
      ["payable balance", 'SELECT coalesce(sum(total),0)::text v FROM "Order" WHERE "paymentStatus"=\'PENDING\''],
    ];
    for (const [label, q] of hard) {
      const a = await num(src, q);
      const b = await num(dst, q);
      out.checks.push({ check: label, src: a, dst: b, ok: a === b });
      if (a !== b) out.problems.push(`${label} differs: src=${a} dst=${b}`);
    }

    // the one that bites: ids hand out from sequences, and a data-only reload never moves them
    const seqQ = `SELECT coalesce(max(last_value),-1)::text v FROM pg_sequences
                  WHERE schemaname='public' AND sequencename = 'Order_id_seq'`;
    const a = Number(await num(dst, seqQ));
    const m = Number(await num(dst, 'SELECT coalesce(max(id),0)::text v FROM "Order"'));
    // being AHEAD of max(id) is fine (ids simply skip); being behind/at-lower means P2002 on insert
    const aligned = a >= m;
    out.checks.push({ check: "Order_id_seq >= max(id)", dst: String(a), expect: String(m), ok: aligned });
    if (!aligned) {
      out.problems.push(
        `"Order" sequence is at ${a} but rows go to ${m} → the next order collides (P2002). Run: deploy/neon-to-vps.sh sequences`
      );
    }
    // the app must be able to read a settings row it needs on every request
    const srows = await num(dst, 'SELECT count(*)::text v FROM "Setting"');
    if (srows === "0") out.problems.push("Setting table is empty on the target — the storefront will 500 without it");

    if (AS_JSON) {
      console.log(JSON.stringify({ ok: out.problems.length === 0, problems: out.problems, ...out }, null, 2));
    } else {
      console.log("\n  table                     neon          vps   ok");
      for (const r of out.tables)
        console.log(`  ${r.table.padEnd(22)} ${String(r.src).padStart(12)} ${String(r.dst).padStart(10)}   ${r.ok ? "yes" : "NO"}`);
      console.log("");
      for (const c of out.checks)
        console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.check}: src=${c.src ?? "-"} dst=${c.dst ?? "-"}`);
    }
    process.exitCode = out.problems.length ? 1 : 0;   // set regardless of --json: CI must fail on drift
    if (out.problems.length && !AS_JSON) {
      console.log(`\n  ${out.problems.length} problem(s):`);
      for (const p of out.problems) console.log(`   - ${p}`);
    } else if (!AS_JSON) {
      console.log(`\n  ✔ ${out.tables.length} tables identical, money + sequences aligned — safe to cut over.`);
    }
  } catch (e) {
    console.error("verify failed:", String(e.message || e).slice(0, 300));
    process.exitCode = 1;
  } finally {
    await src.$disconnect().catch(() => {});
    await dst.$disconnect().catch(() => {});
  }
})();
