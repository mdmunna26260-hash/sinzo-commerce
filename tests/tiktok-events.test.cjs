/* TikTok Pixel / Events API — payload shape, hashing and failure modes.
   Run with: npm run test:unit */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { safeTikTokPixelId } = loader()('lib/sanitize.ts');

function tiktokLoader(settings) {
  return loader({
    './db': { db: { trackingEvent: { create: async () => {} } } },
    './settings': { getSettings: async () => ({}), envFallback: () => settings },
  })('lib/tiktok.ts');
}

const PIXEL = '7614577081535627280';
const TOKEN = 'cdb3b6a29cac0452bd5dbf08d64776e216c381d5';

test('sendTikTokEvent: not configured → no network call, reports configured:false', async () => {
  const { sendTikTokEvent } = tiktokLoader({});
  let called = 0;
  global.fetch = async () => { called++; return { ok: true, json: async () => ({ code: 0 }) }; };
  const r = await sendTikTokEvent({ event: 'Purchase', eventId: 'e1' });
  assert.equal(r.configured, false);
  assert.equal(r.ok, false);
  assert.equal(called, 0, 'must not call TikTok when pixel id/token are missing');
});

test('sendTikTokEvent: posts to v1.3 with Access-Token and hashed user data', async () => {
  const { sendTikTokEvent } = tiktokLoader({ integrations: { tiktokPixelId: PIXEL, tiktokAccessToken: TOKEN } });
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ code: 0, message: 'OK' }) };
  };
  const r = await sendTikTokEvent({
    event: 'Purchase', eventId: 'order_7', eventSourceUrl: 'https://shop.test/order/success',
    userData: { phone: '01812345678', email: 'A@B.com', externalId: '01812345678', clientIp: '1.2.3.4', userAgent: 'UA' },
    properties: { currency: 'BDT', value: 2080 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.configured, true);
  assert.equal(seen.url, 'https://business-api.tiktok.com/open_api/v1.3/event/track/');
  assert.equal(seen.opts.headers['Access-Token'], TOKEN);
  assert.equal(seen.body.event_source, 'web');
  assert.equal(seen.body.event_source_id, PIXEL);
  assert.equal(seen.body.data[0].event, 'Purchase');
  assert.equal(seen.body.data[0].event_id, 'order_7');
  assert.equal(seen.body.data[0].page.url, 'https://shop.test/order/success');
  // phone is sha256 of the trimmed lowercase value — never sent in clear
  const crypto = require('node:crypto');
  const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
  assert.equal(seen.body.data[0].user.phone, h('01812345678'));
  assert.equal(seen.body.data[0].user.email, h('a@b.com'));
  assert.equal(seen.body.data[0].user.external_id, h('01812345678'));
  assert.equal(seen.body.data[0].user.ip, '1.2.3.4', 'ip is sent raw, not hashed');
  assert.equal(seen.body.data[0].properties.currency, 'BDT');
  assert.equal(seen.body.test_event_code, undefined, 'no test code in production mode');
});

test('sendTikTokEvent: TikTok answers HTTP 200 with a non-zero code on rejection', async () => {
  const { sendTikTokEvent } = tiktokLoader({ integrations: { tiktokPixelId: PIXEL, tiktokAccessToken: TOKEN } });
  global.fetch = async () => ({ ok: true, json: async () => ({ code: 40001, message: 'Invalid Access Token' }) });
  const r = await sendTikTokEvent({ event: 'Purchase', eventId: 'e2' });
  assert.equal(r.ok, false, 'a 200 response is NOT success');
  assert.match(r.error, /Invalid Access Token/);
});

test('sendTikTokEvent: test_event_code is forwarded only when configured', async () => {
  const { sendTikTokEvent } = tiktokLoader({ integrations: { tiktokPixelId: PIXEL, tiktokAccessToken: TOKEN, tiktokTestEventCode: 'TEST123' } });
  let body;
  global.fetch = async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ code: 0 }) }; };
  await sendTikTokEvent({ event: 'AddToCart', eventId: 'e3' });
  assert.equal(body.test_event_code, 'TEST123');
});

test('sendTikTokEvent: network failure is caught and reported, never thrown', async () => {
  const { sendTikTokEvent } = tiktokLoader({ integrations: { tiktokPixelId: PIXEL, tiktokAccessToken: TOKEN } });
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const r = await sendTikTokEvent({ event: 'Purchase', eventId: 'e4' });
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.error, /ECONNRESET/);
});

test('safeTikTokPixelId: accepts real ids, rejects anything that could break out of the snippet', () => {
  assert.equal(safeTikTokPixelId(PIXEL), PIXEL);
  assert.equal(safeTikTokPixelId('  CFA1B2C3D4E5  '), 'CFA1B2C3D4E5');
  assert.equal(safeTikTokPixelId("1');fetch('//evil');//"), '');
  assert.equal(safeTikTokPixelId('"><script>alert(1)</script>'), '');
  assert.equal(safeTikTokPixelId(''), '');
  assert.equal(safeTikTokPixelId(null), '');
  assert.equal(safeTikTokPixelId('a'.repeat(41)), '', 'over-long ids are dropped');
});
