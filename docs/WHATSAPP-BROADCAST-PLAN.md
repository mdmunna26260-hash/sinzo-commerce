# WhatsApp Broadcast & Automation — Implementation Plan

> **Status:** plan for review (not started). Locked from your answers: **Baileys multi-device**,
> **2–3 numbers**, **500–2000 recipients per broadcast**, no Cloud API for now.
> Everything below is scoped to that. Nothing in this plan sends a message to a real customer
> during development — the test harness only talks to a test number / a local stub.

---

## 1. Goal

আপনার নিজের ২–৩টা WhatsApp number দিয়ে:

1. যারা order করছে তাদের **auto order-confirmation** (আর চাইলে confirmed/packed/shipped/delivered/cancelled/review — প্রতিটার আলাদা toggle)
2 . customer-কে **product link, ছবি (multi-image), discount code** সহ message
3. **Broadcast campaign** — audience বাছা → compose → schedule → পাঠানো → report (কে পেল, کে পড়ল, কে কিনল)
4. সব কিছু **নিরাপদে** — pace/limit/warm-up/opt-out মেনে, যাতে number ban না হয়

**Out of scope (এখন না):** Meta Cloud API channel, chatbot flow builder, WhatsApp payment, catalog sync.
(Phase 4-এ Cloud API যোগ করা যাবে — কাঠামোটা সেভাবেই রাখা হবে।)

---

## 2. এখন যা আছে (baseline)

| আছে | কোথায় |
|---|---|
| Baileys bridge, **১টা** session (`wa-session/`), `/status /qr /send /logout` | `scripts/whatsapp-bridge.js` |
| Inbound message → inbox, order-এর সাথে phone দিয়ে auto-link | `app/api/wa/inbound/route.ts`, `/admin/inbox` |
| Order confirm text (fire-and-forget, retry নেই, সব order-এ একই) | `whatsappCustomerOrder()` (`lib/notify.ts`) |
| প্রথম message-এ auto reply, `x-bridge-key` দিয়ে সুরক্ষা | Settings → Notifications |
| Review request WhatsApp→SMS fallback | `lib/review-request.ts` (item 13) |

**নেই:** multi-device, queue/schedule, bulk, image/multi-image, product card, coupon attach,
audience segment, opt-out/STOP, delivery/read receipt, campaign report.

---

## 3. Architecture

```
 Admin panel (£/admin/whatsapp/*)
        │  compose / audience / schedule / pause
        ▼
   Postgres|SQLite  ──  WaMessage (outbox queue)  ◄── /api/checkout (auto order confirm)
        ▲                        │
        │  status/receipt        │  claim batch (respecting caps, quiet hours)
        │                        ▼
        │              scripts/wa-worker.js   (PM2 / cron on the VPS)
        │                        │  HTTP (127.0.0.1, x-bridge-key)
        │                        ▼
        │         scripts/whatsapp-bridge.js  ── Baileys ──► WhatsApp
        │            (2–3 device sessions in .wa-auth/<sessionId>/)
        └────────── webhooks: /api/wa/inbound · /api/wa/receipt · /api/wa/device
```

Key rules:
* **No message is ever sent inside a web request.** Everything is written to `WaMessage` first, the worker sends it. So a slow/blocked number never blocks the shop.
* The **bridge is the only thing that talks to WhatsApp**; the app never holds session keys (they stay on disk, outside the repo).
* The **worker is the only thing that decides pacing** (per device caps, quiet hours, retries), and the bridge enforces a second, lower-level delay between messages.

---

## 4. Throughput & ban-safety math (the part worth reviewing)

Baileys is the unofficial protocol — Meta doesn't publish limits, and behaviour depends on the
number's age/quality. Plan is therefore deliberately conservative and **fully configurable**.

**Pacing (defaults, per device)**
* inside a burst: 1 message / 6–12 s (random)
* burst = 20–40 messages, then pause 3–6 min (human-like, not a robot rhythm)
* effective ≈ **250 messages/hour/device** — say 300 as a ceiling
* **daily cap/device: new number 50 → 2nd week 150 → 3rd week 300 → mature 400** (hard block above cap; owner can raise it, with a warning)
* quiet hours **22:00–09:00** (configurable) — broadcast শুধু তার মধ্যে; order-confirm urgent হলে সাথে সাথে (customer expect করে)

**তাহলে সময় লাগবে (effective 250/hr, daily cap respected):**

| recipients | 1 device | 2 devices | 3 devices |
|---|---|---|---|
| 500 | ~2 h | ~1 h | ~40 min |
| 1000 | ~4 h | ~2 h | ~1 h 20 |
| 2000 | ~8 h → ২ দিনে ভাগ | ~4 h → ২ দিনে ভাগ | ~2 h 40 → ২ দিনে ভাগ |

> **সিদ্ধান্তের পয়েন্ট:** ২০০০ জনকে *একদিনে* পাঠাতে হলে ৩টা device-এর দৈনিক cap ৭০০+ করতে হবে —
> নতুন number-এ সেটা ঝুঁকিপূর্ণ। তাই default plan: **campaign queue ১–২ দিন ধরে চলে** (schedule +
> daily cap), অথবা Phase 4-এ ওই বড় blast-গুলো **Cloud API** দিয়ে (paid, কিন্তু ban ঝুঁকি নেই)।

**Ban ঝুঁকি কমানোর নিয়ম (code-এ enforced)**
1. শুধু relationship আছে এমন number-এ: order history (transactional) বা explicit opt-in (marketing). CSV import-এ `optedIn=true` ছাড়া marketing ট্যাগ হবে না।
2. হুবহু একই text হাজারে যাবে না — `{name}` personalization + template variant rotate (২–৩টা wording)।
3. Link-heavy bulk নয়: ছবি ১–৩টার বেশি নয়, প্রতিটা **< 1 MB** (আগে compress), text ≤ 600 char।
4. **Auto-pause triggers:** device logout/401/403 · ৫০ message-এর sample-এ >15% fail · bridge offline · owner-এর Pause switch. তখন campaign PAUSED + admin-কে alert (in-app + Telegram থাকলে)।
5. নতুন number-এ প্রথম সপ্তাহে শুধু সেই customer-দের যারা শেষ ৩০ দিনে order করেছে (এরা reply দেওয়ার সম্ভাবনা বেশি → number-এর trust বাড়ে)।
6. প্রতি message-এ শেষে ছোট opt-out লাইন: *"Offers bondho korte 'STOP' likhun"* (transactional-এও ২-৩টা campaign পরপর)।

---

## 5. Data model (নতুন table)

```prisma
model WaDevice {            // ২–৩টা number
  id Int @id @default(autoincrement())
  name String               // "Sinzo Support"
  phone String?             // pairing-এর পরে bridge থেকে আসে
  sessionId String @unique  // .wa-auth/<sessionId>/  (keys কখনো DB-তে না)
  status String @default("DISCONNECTED") // CONNECTED|DISCONNECTED|QR|PAUSED|BANNED
  isDefault Boolean @default(false)
  dailyCap Int @default(150)
  sentToday Int @default(0)
  sentDate String?          // YYYY-MM-DD counter reset
  warmupStage Int @default(0)
  lastSeenAt DateTime?
  lastError String?
  createdAt DateTime @default(now())
}

model WaTemplate {
  id Int @id @default(autoincrement())
  key String @unique        // order_placed | order_shipped | broadcast_promo …
  name String
  category String @default("UTILITY")   // UTILITY | MARKETING
  body String               // {name} {order} {amount} {tracking} {product} {coupon} {link}
  mediaMode String @default("NONE")     // NONE | PRODUCT | CUSTOM
  active Boolean @default(true)
  updatedAt DateTime @updatedAt
}

model WaBroadcast {
  id Int @id @default(autoincrement())
  name String
  body String
  templateKey String?
  images String?            // JSON: image URLs
  productIds String?        // JSON: product-card ids
  couponCode String?
  audienceRule String       // JSON: {type, days, productId, area, optedInOnly, excludeRecentDays}
  deviceIds String?         // JSON: [deviceIds]; খালি = auto (least loaded)
  status String @default("DRAFT")  // DRAFT|SCHEDULED|RUNNING|PAUSED|DONE|FAILED
  scheduledAt DateTime?
  total Int @default(0); sent Int @default(0); failed Int @default(0); skipped Int @default(0)
  createdBy String?; createdAt DateTime @default(now()); startedAt DateTime?; finishedAt DateTime?
}

model WaMessage {           // outbox + history (receipt সহ)
  id Int @id @default(autoincrement())
  deviceId Int?
  toWaId String
  kind String               // AUTO | BROADCAST | REPLY | MANUAL
  templateKey String?
  body String
  mediaJson String?
  couponCode String?
  orderId Int?
  broadcastId Int?
  status String @default("QUEUED") // QUEUED|SENDING|SENT|DELIVERED|READ|FAILED|SKIPPED
  attempts Int @default(0)
  error String?
  dedupeKey String? @unique  // "order_placed:1234" → একই order-এ দুইবার নয়
  queuedAt DateTime @default(now()); sentAt DateTime?; deliveredAt DateTime?; readAt DateTime?
}

model WaLink {              // short link + click tracking
  id Int @id @default(autoincrement())
  slug String @unique
  target String
  broadcastId Int?
  clicks Int @default(0)
  createdAt DateTime @default(now())
}

model WaOptOut {
  id Int @id @default(autoincrement())
  waId String @unique
  reason String?            // STOP keyword | replied | manual
  createdAt DateTime @default(now())
}
```

সাথে: `Customer.waOptIn Boolean @default(false)` + `waOptInAt DateTime?` (marketing eligibility),
আর `notifications` settings group-এ: `waAutoConfirm`, `waEventToggles{...}`, `waDailyCapDefault`,
`waQuietHours`, `waCouponOnOrder`, `waTestMode`.

Schema দুই জায়গায় যাবে (`prisma/schema.prisma` + `schema.prod.prisma` — `npm run schema:sync` দিয়ে),
আর চলতি SQLite-এ migration + `db-ensure` DDL (install-এ auto-create)।

---

## 6. Bridge API (scripts/whatsapp-bridge.js-এ যোগ)

```
GET    /devices                 → [{sessionId,name,status,me,lastSeen,qrPending}]
POST   /devices {sessionId,name}→ device boot (QR তৈরি হয়)
GET    /devices/:id/qr          → {status, qr} in
POST   /devices/:id/logout      → session মুছে ফেলে
POST   /send {deviceId,to,text} → (existing, extended)
POST   /send-media {deviceId,to,images[],caption,productCard}
POST   /send-batch {deviceId,items[]}  → bridge নিজে pace করে, per-item result
GET    /health                  → worker/monitor-এর জন্য
```
App-এ webhook: `/api/wa/inbound` (আছে) · `/api/wa/receipt` (delivered/read) · `/api/wa/device` (state change, ban/logout signal)।

Session: `.wa-auth/<sessionId>/` (repo-র বাইরে, `.gitignore`), প্রতি device-এর জন্য reconnect with backoff, logout হলে ফাইল মুছে যায়, **session backup** script (`npm run wa:backup` — সপ্তাহে একবার)।

---

## 7. Worker & ops

* `scripts/wa-worker.js` — প্রতি ২০ সেকেন্ডে: quiet hours/cap check → `WaMessage`-এর QUEUED batch claim → device বাছা (least loaded) → bridge-এ পাঠানো → status/receipt update → failure হলে backoff retry (3 attempt) → campaign counters update → দরকারে auto-pause।
* চালানো: **PM2** (`pm2 start scripts/wa-worker.js --name sinzo-wa-worker`) নয়তো `/api/wa/tick` + VPS cron (PM2 না থাকলে)। ব্রিজও PM2-তে (`sinzo-wa-bridge`) — দেখুন §14।
* Health: `/admin/whatsapp/devices`-এ banner — bridge down / device disconnected হলে লাল, সাথে অফার: QR আবার scan / worker restart কমান্ড।
* Log: সব send Admin → Logs-এ (`kind=WHATSAPP`), প্রতি row-তে device, to, template, result। retention 30 দিন।

---

## 8. Admin screens (নতুন)

| Page | কী থাকবে |
|---|---|
| `/admin/whatsapp` | campaign list + KPI (queued/sent/failed, delivered/read %), status, action (run/pause/resume/duplicate/delete/report) |
| `/admin/whatsapp/new` | composer: template picker · body editor (variable chips) · **multi-image upload (preview + reorder)** · product picker (card) · coupon attach · **audience panel with live count** · device choice · schedule · "test to my number" · "first 5-এ পাঠাও" · তারপর Start |
| `/admin/whatsapp/[id]` | report: progress, per-status counts, delivery/read, failure list + only-failed retry, link clicks, **orders attributed**, CSV |
| `/admin/whatsapp/devices` | device cards: QR modal · status/phone · daily usage vs cap · warm-up stage · pause/resume · rename · set default · logout |
| `/admin/whatsapp/templates` | template list + editor + preview + test send (event template গুলো এখানেই) |
| `/admin/inbox` (extend) | quick action: product card / images / coupon পাঠানো · quick replies · "mark opted-out" · thread-এ broadcast/bulk message-ও দেখা যাবে |
| Sidebar | নতুন গ্রুপ **WhatsApp**: Inbox · Broadcast · Devices · Templates |

---

## 9. Message flows

**A. Order placed (auto, Phase 1)**
`/api/checkout` commit → `WaMessage{QUEUED, kind=AUTO, template=order_placed, dedupeKey="order_placed:<id>"}` →
worker → customer-এর number-এ: `Hi {name}! Apnar order {code} confirm hoyeche` + item lines + **Total/COD** +
delivery ETA + (সবচেয়ে দামি item-এর) **ছবি** + **tracking link** (consignment হলে) + চাইলে **coupon** +
`STOP` লাইন। Device offline → up to 6 ঘণ্টা queue-তে থাকে, তারপর **SMS fallback** (item 7) + log।
Order-এর প্রতিটা event (confirmed/packed/shipped/delivered/cancelled/review) আলাদা toggle — সব একই pipeline দিয়ে।

**B. Broadcast (Phase 3)**
compose → audience resolve (dedupe, opt-out বাদ, opt-in check) → `total` count দেখানো → schedule/start →
প্রতি recipient-এ `WaMessage{BROADCAST}` → worker device-গুলোতে ভাগ করে (least loaded) pace মেনে পাঠায় →
receipt এলে DELIVERED/READ → report-এ counters + link clicks + attributed orders।

**C. Inbound / STOP**
customer লিখলে → `/api/wa/inbound` (আছে) → inbox + thread → যদি `STOP/UNSUBSCRIBE/BLOCK/OFF` লেখে →
auto `WaOptOut` + একটা polite confirmation (`Aapnake list theke bad diyechi…`) → এরপর ওই number-এ marketing যাবে না (transactional order update যাবে, কারণ সেটা তার order-এর তথ্য)।

**D. Receipts**
bridge `messages.update` → `/api/wa/receipt {waMessageId,status}` → `WaMessage.deliveredAt/readAt` → report ও campaign-এ read %।

---

## 10. Audience builder (আসল data থেকে)

`all_customers` (≥1 order) · `recent_buyers` (last N দিন) · `product_buyers` (X কিনেছে) ·
`collection_buyers` · `cancelled_only` · `high_spenders` (Σ ≥ ৳N) · `area` (Inside/Outside Dhaka) ·
`waitlist` (stock-এর অপেক্ষায়) · `opted_in` (marketing-eligible) · `csv_import` (opt-in flag সহ)।

সব segment-এ auto: duplicate number বাদ · `WaOptOut` বাদ · invalid number বাদ · "last X দিনে message পেয়েছে" বাদ দেওয়ার option · count preview (send করার আগেই দেখা যাবে কতজন)।

---

## 11. Phases, deliverables, acceptance test

**Phase 1 — Foundation (≈1 round)**
multi-device manager + QR (admin) · `WaDevice/WaMessage/WaTemplate` tables + migration · outbox queue ·
worker (pacing, caps, quiet hours, retry) · **auto order-confirm** (ছবি + tracking + COD + coupon) ·
per-event toggles · SMS fallback · receipts · Logs integration.
*Acceptance:* test number-এ order দিলে ৩০ সেকেন্ডে confirmation যায়; device বন্ধ থাকলে queue-তে দাঁড়িয়ে পরে SMS fallback; caps/quiet-hours code-এ enforced (harness-এ assert); ২টা device একসাথে চলে ও status page ঠিক দেখায়।

**Phase 2 — Toolkit (≈1 round)**
templates editor + preview + test send · multi-image (২–১০, compress) · product card (ছবি+নাম+দাম+লিংক) ·
coupon attach · inbox quick actions · `{variable}` engine + Bangla-safe text.
*Acceptance:* panel থেকে ৩টা ছবি + product link + coupon দিয়ে নিজের number-এ পাঠানো যায়; template save/reload; image > 1 MB হলে auto-compress।

**Phase 3 — Broadcast (≈1–2 round)**
audience builder + live count · composer + schedule · campaign list/report · link clicks (short link) ·
attributed orders · failure retry · opt-out/STOP pipeline · CSV import · CSV export।
*Acceptance:* ৫০ জনের test segment-এ campaign চালিয়ে report মেলে; STOP লিখলে opt-out + confirmation; pause/resume/auto-pause কাজ করে; সব send Logs-এ।

**Phase 4 — পরে (আপনি চাইলে)**
Cloud API channel (বড় blast-এর জন্য) · automation flows (abandoned cart, win-back, birthday) ·
A/B text · contact tags & segments UI · best-time-to-send।

---

## 12. ঝুঁকি ও সীমা (স্পষ্ট করে বলছি)

* **Baileys unofficial** — Meta-র ToS-এর বাইরে; ban হলে number-টা WhatsApp থেকে বাদ যেতে পারে (session backup থেকে নতুন number-এ যাওয়া যায়, কিন্তু ban ফেরানো যায় না)। তাই caps + warm-up + relationship-only rule।
* **২০০০/দিন এক number-এ নিরাপদ নয়** — তাই queue ১–২ দিন ধরে চলে; বড় blast-এর জন্য Phase 4-এ Cloud API সুপারিশ।
* **VPS ২৪/৭ চালু থাকতে হবে** (bridge + worker)। PC বন্ধ মানে message queue-তে দাঁড়িয়ে থাকবে (হারাবে না)।
* **Number-এর মালিকানা** — business number হলে ভালো; ব্যক্তিগত number-এ bulk গেলে সেটাও ban-ঝুঁকিতে পড়ে।
* **Media** — WhatsApp-এর ছবি limit ~5 MB, আমরা < 1 MB রেখে compress করব।

---

## 13. আপনার কাছ থেকে যা দরকার

1. **২–৩টা number** (যে number দিয়েই এখন customer-দের সাথে কথা হয় — একদম নতুন number হলে প্রথম সপ্তাহে ধীরে শুরু করব)।
2. **VPS-এ bridge + worker চালানোর অনুমতি** (PM2 বা systemd) + একটা `WA_BRIDGE_KEY`।
3. **Consent নীতি approve:** transactional (order update) সবার জন্য; marketing শুধু opt-in-দের জন্য; order message-এ "STOP লিখলে বন্ধ" লাইন যোগ করে opt-in ধীরে গড়ে তোলা।
4. **Template-এর wording**: Bangla না English না mix? (ডিফল্ট: Banglish + emoji, আপনার brand-এর tone)।
5. **Phase 1-এ ছবি**: product-এর ছবিগুলোই ব্যবহার করব (আলাদা কিছু লাগবে না) — ঠিক আছে?

**Effort:** Phase 1 ≈ ১ round · Phase 2 ≈ ১ round · Phase 3 ≈ ১–২ round (প্রতিটা আলাদা commit +
verification harness + Bengali wrap-up, আগের কাজগুলোর মতোই)।

---

## 14. Phase 1 — যা বানানো হলো + চালু করার নিয়ম

**কোড (Phase 1):**

| File | কাজ |
|---|---|
| `scripts/whatsapp-bridge.js` | Baileys multi-device bridge — প্রতি number-এর আলাদা session (`.wa-auth/<sessionId>/`), QR, `/send`, `/send-media`, `/devices*`, inbound + receipt + device-state webhook, প্রতি send-এ ৩ সেকেন্ড gap |
| `scripts/wa-worker.js` | worker loop — `/api/wa/tick` কে ডাকে, `nextInSec` ধরে sleep করে (`npm run wa:worker`) |
| `lib/wa-queue.ts` | outbox: `enqueueOrderEvent()`, ৬টা event template (seed), variable render, dedupe, test mode, coupon, rules (`settings.whatsapp`) |
| `lib/wa-worker.ts` | `runWaTick()` — claim, device বাছাই (least loaded), cap/warm-up, quiet hours (marketing only), retry 2/10/30 মিনিট, ≥৫ consecutive failure-এ device auto-pause, ৬ ঘণ্টা queue-তে থাকলে SMS fallback |
| `app/api/wa/{tick,receipt,device}` | worker endpoint + bridge webhook (worker key / bridge key দিয়ে protected) |
| `app/api/admin/whatsapp/{route,devices,templates}` | hub, device manager, template editor |
| `app/admin/(panel)/whatsapp/{…}` | Broadcast & Queue · Devices · Templates UI (+ sidebar-এ WhatsApp group) |
| `prisma/schema.prisma` | `WaDevice`, `WaTemplate`, `WaMessage` (+ production schema ও `lib/db-ensure.ts`-এ একই DDL) |

**Event wiring (নতুন কিছু লাগে না — নিজে থেকেই চলে):** checkout → `order_placed` · status change → confirmed/packed/shipped/delivered/cancelled · scan-to-pack → `order_packed` · courier consignment → `order_shipped` (+ delivered)। প্রতিটার ON/OFF Admin → WhatsApp → Templates-এ।

**চালু করার ধাপ (VPS):**

```bash
# 1) .env
WA_BRIDGE_KEY=<long-random>        # app ও bridge একই key ব্যবহার করবে
WA_BRIDGE_PORT=3001                # bridge শুধু 127.0.0.1-এ bind করে
WA_APP_URL=http://127.0.0.1:3000   # অ্যাপ যেখানে চলছে (webhook-এর জন্য)
WA_WORKER_KEY=<long-random>        # optional; না দিলে bridge key-ই ব্যবহার হবে

# 2) bridge + worker চালু
npm install
pm2 start scripts/whatsapp-bridge.js --name sinzo-wa-bridge
pm2 start scripts/wa-worker.js --name sinzo-wa-worker
pm2 save

# app
pm2 start npm --name sinzo-web -- start
```

**Admin-এ pairing:** Admin → **WhatsApp → Devices** → *Add device* → নাম দিন → *Pair QR* → WhatsApp app → Linked devices → QR scan (৬০ সেকেন্ডের মধ্যে; একসাথে ২–৩টা number রাখা যায়, একটা default) → status pill `CONNECTED` হয়ে যাবে, phone number দেখাবে।
এরপর Admin → **WhatsApp → Broadcast & Queue**: master switch, quiet hours (ডিফল্ট 22:00–09:00), daily cap (নতুন number-এ 50 → warm-up 150/300/400), SMS fallback, test mode (+ test number), coupon code, worker key। ওখান থেকেই *Run now* / *Test send* / queue retry-cancel।

**নিশ্চয়তা (code-এ enforced):** কোনো send web request-এর ভেতরে হয় না (শুধু `WaMessage` row লেখা হয়) → checkout কখনও WhatsApp-এর জন্য slow হবে না · cap/quiet-hours/backoff code-এ · device unbind/ban হলে delivery বন্ধ, message queue-তে থেকে যায়, SMS gateway configured থাকলে fallback · সব send Admin → Logs-এ (`kind=WHATSAPP`) · STOP লাইন template-এ আছে (Phase 3-এ opt-out auto)।

**Verification (এই round):** 84-check WhatsApp harness (dev DB + stub bridge + stub SMS gateway) — key checks, device lifecycle, order→queue→send→receipt, dedupe, quiet hours, caps, retry→FAILED, auto-pause, SMS fallback, invalid number, worker script, bridge-down, master switch, test mode, তিনটা admin page · `npm test` 47/0 · `tsc` clean · production build (সব WhatsApp route build হয়েছে)।

---

## 15. Phase 2 — যা বানানো হলো (templates · multi-image · product card · inbox)

Phase 1-এর উপরে এবার **owner-এর হাতের toolkit** যোগ হলো — এখন Admin থেকে নিজে message সাজিয়ে পাঠানো যায়,
শুধু automatic template-এর উপর নির্ভর করতে হয় না।

**নতুন কোড:**

| File | কাজ |
|---|---|
| `lib/wa-media.ts` | ছবি upload + auto-compress: EXIF rotate → max 1600px → JPEG quality 84→52 ধরে **≤ 950 KB**; jpg/png/webp/avif/gif (≤25 MB); ফাইল যায় `public/uploads/wa/`-এ, delete API-ও আছে |
| `lib/wa-messages.ts` | toolkit: `searchCatalog`, `catalogById`, `productCardText` (নাম + দাম + link), `composeMessage` (body + ছবি + product card + coupon + STOP লাইন), `sendNow`, `orderContext` |
| `app/api/admin/whatsapp/media` | multipart upload — একসাথে ≤10 ছবি, প্রতি ছবির `{url,width,height,bytes,originalBytes,quality,text}` + error list; `DELETE ?url=` |
| `app/api/admin/whatsapp/send` | compose send (body/product/ছবি/coupon/STOP) **অথবা** order-event send (`orderId\|orderCode` + `templateKey`, `immediate`) |
| `app/api/admin/whatsapp/order` | order context: order + items + আগের message history + suggested event + preview + suggested ছবি |
| `app/api/admin/whatsapp/preview` | catalogue search — product picker-এর ডেটা + preview + char/part counter |
| `app/admin/(panel)/whatsapp/compose` | **New message** স্ক্রিন: live WhatsApp bubble preview, ≤10 ছবি (১ম ছবির caption হয়), product picker, coupon attach, STOP toggle, quick reply chips, order mode (`?order=ORD-…`) |
| `app/admin/(panel)/inbox` (rewrite) | inbox-এ search + live list, order-context bar, event template chips, photo upload, product picker, quick replies, *Full composer* + `wa.me` link |
| `lib/wa-queue.ts` `lib/wa.ts` `scripts/whatsapp-bridge.js` | multi-image send (`images[]`), ORDER_ITEMS mode (order-এর ≤3 distinct item-এর ছবি), quickReplies, Bangla-safe clamp (surrogate-safe, ≤4000 char), queue-এ media **absolute URL** হিসেবে জমা হয় (worker-এর যেই bridge-ই হোক, ছবি fetch করতে পারে) |

* `templates` API/এডিটর এখন `NONE / PRODUCT / ORDER_ITEMS` media mode দেখায় (ORDER_ITEMS = order-এর আসল item ছবিগুলো), body limit 4000 char, preview caption সহ।
* Hub-এ **Quick replies** card — এখানে লেখা reply inbox ও composer-এ chip আকারে আসে (`quickReplies[]`, ≤12 × ≤400 char)।
* Sidebar-এ WhatsApp group → *New message*।

**Acceptance (plan §11) — পাস:** panel থেকে ৩ ছবি + product link + coupon দিয়ে নিজের number-এ send ✓ · template save → reload ✓ · 1 MB-র বড় ছবি auto-compress (মূল ফাইল > 1 MB, পাঠানো ফাইল ≤ 950 KB) ✓ · inbox reply-তে ছবি + product card ✓ · Bangla লম্বা text কাটে না (code point ধরে) ✓।

**Verification (এই round):** নতুন WhatsApp harness (dev DB + stub bridge + stub SMS) — **72 passed / 0 failed** (Phase 1 regression + Phase 2), `npm test` **59/0**, `tsc` clean, production build সব WhatsApp route সহ exit 0। Harness নিজের সব fixture নিজে মুছে ফেলে (orders 0 · wa 0 · devices 0)।

**Verification-এ ধরা পড়া ৩টি আসল বাগ (fixed):**

1. **Device number ভুল দেখাচ্ছিল** — bridge-এর `me` হয় `8801xxxxxxxxx:12@s.whatsapp.net`; আগে শুধু digit নেওয়া হতো তাই tail-এর `12` phone-এর সাথে জুড়ে যেত (`88018315959921`)। এখন `:`-এর আগের অংশ নেওয়া হয় → সঠিক number।
2. **Panel-এর send older queue-র পিছনে পড়ে থাকত** — worker oldest-first পাঠায়, তাই panel থেকে পাঠানো message-ও queue-তে অপেক্ষা করত। এখন owner-triggered send নিজে কয়েকটি tick চালায় (শুধু message সত্যিই বেরোলে; cap/quiet-hours হলে থেমে যায়)।
3. **Order update-এ event label হারিয়ে যেত** — `sendNow` `templateKey` forward করত না, ফলে row-তে template শূন্য থাকত (report/analytics-এ গরমিল হতো)।

**চালু করার ধাপ (Phase 2-এর জন্য নতুন কিছু লাগে না):** আগের §14-এর bridge + worker চালু থাকলেই হবে — Media/Bridge-এ নতুন permission/env নেই।

**সীমা (এখনো open):** broadcast/Audience builder, schedule, report, link click tracking, STOP auto-opt-out, CSV import — এগুলো **Phase 3** (ততদিন STOP লাইন message-এ থাকবে, কিন্তু STOP এলে নিজে থেকে list থেকে বাদ যাবে না — Admin → Customers-এ হাতে দেখে বাদ দিতে হবে)।
