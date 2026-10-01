#!/usr/bin/env node
/* Authenticated recovery scheduler. Automatic recovery is OFF until enabled in
   Admin → Marketing; this worker never reads or prints SMTP/customer credentials.
   npm run recovery:run (one pass), npm run recovery:worker (5-minute polling). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
for (const filename of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', filename), 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch {}
}
const secret = process.env.CRON_SECRET || '';
if (secret.length < 32 || /change.?me|your.?secret|placeholder/i.test(secret)) { console.error('Set a strong runtime CRON_SECRET before starting recovery scheduler.'); process.exit(1); }
const endpoint = process.env.RECOVERY_API_URL || 'http://127.0.0.1:3000/api/admin/abandoned-recover';
const url = new URL(endpoint);
if (!['http:', 'https:'].includes(url.protocol)) throw Error('Invalid RECOVERY_API_URL');
const once = process.argv.includes('--once');
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
async function run() {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(300_000), redirect: 'error' });
    const result = await response.json();
    if (!response.ok) { console.error('Recovery pass rejected (HTTP ' + response.status + '). Check settings/server logs.'); return false; }
    console.log(result.disabled ? 'Automatic recovery is disabled in Marketing settings.' : `Recovery pass: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}`);
    return result.failed === 0;
  } catch { console.error('Recovery pass unavailable. Ambiguous sends are not automatically retried.'); return false; }
}
(async () => {
  do {
    const ok = await run();
    if (once) { process.exitCode = ok ? 0 : 1; break; }
    // Short sleeps allow a clean stop without overlapping passes.
    for (let i = 0; i < 60 && !stopping; i++) await new Promise(r => setTimeout(r, 5000));
  } while (!stopping);
})().catch(() => { process.exitCode = 1; });
