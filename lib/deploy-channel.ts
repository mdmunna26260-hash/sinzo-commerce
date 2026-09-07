/* Which deployment am I?
   Vercel sets VERCEL=1 automatically on its runtime — zero config needed.
   The VPS docker-compose sets DEPLOY_CHANNEL=vps explicitly.
   Orders are tagged with this channel at checkout; each admin panel only
   shows its own channel's orders (?channel=all to override). */
export function deployChannel(): "vps" | "vercel" {
  if (process.env.VERCEL === "1") return "vercel";
  return process.env.DEPLOY_CHANNEL === "vercel" ? "vercel" : "vps";
}
