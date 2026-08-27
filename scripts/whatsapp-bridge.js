/* WhatsApp Linked-Device Bridge (Baileys / multi-device protocol)
   - Runs as a SEPARATE local service (binds 127.0.0.1 only — never exposed)
   - Admin panel shows the pairing QR; scan once from WhatsApp → Linked devices
   - Session persists in ./wa-session so reconnects need no re-scan
   Run: npm run wa  */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");
const http = require("http");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const PORT = Number(process.env.WA_BRIDGE_PORT || 3001);
const KEY = process.env.WA_BRIDGE_KEY || "local-bridge";
const AUTH_DIR = path.join(__dirname, "..", "wa-session");

let sock = null;
let latestQR = null;
let connected = false;
let myInfo = null;
let starting = false;
let wantConnected = true;

async function start() {
  if (starting || !wantConnected) return;
  starting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: ["SINZO Commerce", "Chrome", "1.0"],
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) { latestQR = qr; console.log("QR ready — scan from WhatsApp → Linked devices"); }
      if (connection === "open") {
        connected = true; latestQR = null; myInfo = sock.user || null;
        console.log("WhatsApp connected as", sock.user?.id || "?");
      }
      if (connection === "close") {
        connected = false; myInfo = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.log("Device logged out. Removing session — restart bridge to re-pair.");
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
          starting = false;
          setTimeout(start, 2000);
          return;
        }
        console.log("Connection closed (" + code + ") — reconnecting in 3s…");
        starting = false;
        setTimeout(start, 3000);
        return;
      }
    });
  } catch (e) {
    console.error("bridge start error:", e?.message || e);
  }
  starting = false;
}

function authorized(req) {
  return (req.headers["x-bridge-key"] || "") === KEY;
}
function jidFor(number) {
  const digits = String(number || "").replace(/[^0-9]/g, "");
  return digits + "@s.whatsapp.net";
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url || "/", "http://x");
  const done = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  if (!authorized(req)) return done(401, { error: "bad bridge key" });

  if (url.pathname === "/status") {
    return done(200, { running: true, connected, me: myInfo?.id || null, name: myInfo?.name || null, qrPending: !!latestQR });
  }
  if (url.pathname === "/qr") {
    if (connected) return done(200, { connected: true, qr: null });
    if (!latestQR) return done(200, { connected: false, qr: null, hint: "waiting for QR from WhatsApp servers…" });
    try {
      const dataUrl = await qrcode.toDataURL(latestQR, { margin: 1, width: 320 });
      return done(200, { connected: false, qr: dataUrl });
    } catch (e) { return done(500, { error: "qr render failed" }); }
  }
  if (url.pathname === "/send") {
    if (req.method !== "POST") return done(405, { error: "POST only" });
    if (!connected || !sock) return done(503, { error: "WhatsApp not connected — scan QR first" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { to, message } = JSON.parse(body || "{}");
        if (!to || !message) return done(400, { error: "to & message required" });
        const jid = jidFor(to);
        const r = await sock.sendMessage(jid, { text: String(message).slice(0, 4000) });
        return done(200, { ok: true, id: r?.key?.id || null, to: jid });
      } catch (e) { return done(502, { ok: false, error: e?.message || "send failed" }); }
    });
    return;
  }
  if (url.pathname === "/logout" && req.method === "POST") {
    try {
      wantConnected = false;
      try { await sock?.logout(); } catch { try { sock?.end(undefined); } catch {} }
      try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
      connected = false; latestQR = null; myInfo = null;
      wantConnected = true; starting = false;
      setTimeout(start, 1500);
      return done(200, { ok: true, hint: "unpaired — new QR will appear" });
    } catch (e) { return done(500, { error: e?.message || "logout failed" }); }
  }
  return done(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`WhatsApp bridge listening on 127.0.0.1:${PORT} (private)`);
});
start();
