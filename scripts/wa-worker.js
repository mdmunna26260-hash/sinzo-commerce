/* WhatsApp worker — the process that actually moves the queue.
   -----------------------------------------------------------------
   It owns the pacing decision; the app owns the rules. Every tick it asks the store
   `POST /api/wa/tick` (that is where caps, quiet hours, retries, SMS fallback and the device
   choice live), then sleeps for the delay the tick asked for:

     • 1 message every ~6–12 s while there is work   ≈ 250 messages/hour/device
     • a longer pause when the queue is empty or every device is capped

   Run it next to the bridge on the VPS:

     pm2 start scripts/wa-worker.js --name sinzo-wa-worker
     pm2 save

   Without PM2, a cron entry does the same thing in one shot:

     * * * * * curl -fsS -X POST -H "x-wa-worker-key: $WA_WORKER_KEY" http://127.0.0.1:3000/api/wa/tick >/dev/null

   Env: WA_APP_URL (default http://127.0.0.1:3000) · WA_WORKER_KEY (or WA_BRIDGE_KEY)
   Exit cleanly on SIGTERM so PM2 restarts do not leave a claimed message behind. */
const fs = require("fs");
const path = require("path");

// cron / pm2 do not run through Next.js, so load .env ourselves
try {
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const APP = (process.env.WA_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const KEY = process.env.WA_WORKER_KEY || process.env.WA_BRIDGE_KEY || "local-bridge";
const MIN_SLEEP = Number(process.env.WA_WORKER_MIN_SLEEP || 5);
const ERROR_SLEEP = Number(process.env.WA_WORKER_ERROR_SLEEP || 60);

let stopping = false;
let failures = 0;
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[wa-worker ${stamp()}]`, ...a);

const sleep = (sec) => new Promise((r) => setTimeout(r, Math.max(1, sec) * 1000));

async function tick() {
  const res = await fetch(`${APP}/api/wa/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wa-worker-key": KEY },
    body: JSON.stringify({ limit: 3 }),
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 140)}`);
  }
  return res.json();
}

async function main() {
  log(`watching ${APP} (worker key ${KEY === "local-bridge" ? "default" : "set"})`);
  while (!stopping) {
    let next = 30;
    try {
      const r = await tick();
      failures = 0;
      if (r.disabled) log("auto messages are switched off — queue paused (Settings → WhatsApp)");
      else if (r.sent || r.failed || r.retried || r.smsFallback) {
        log(`sent ${r.sent} · failed ${r.failed} · retry ${r.retried} · sms ${r.smsFallback} · skipped ${r.skipped} · queued device: ${r.devices.filter((d) => d.status === "CONNECTED").length}/${r.devices.length}${r.notes?.length ? " · " + r.notes.join("; ") : ""}`);
      }
      next = Number(r.nextInSec) || 30;
    } catch (e) {
      failures += 1;
      log(`tick failed (${failures}): ${e?.message || e}`);
      next = Math.min(ERROR_SLEEP * failures, 300);
    }
    await sleep(Math.max(MIN_SLEEP, next));
  }
  log("stopped");
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { stopping = true; log(`${sig} received — finishing`); setTimeout(() => process.exit(0), 200); });
}

main().catch((e) => { console.error("[wa-worker] fatal:", e); process.exit(1); });
