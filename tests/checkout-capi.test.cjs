/* Server-side Purchase (Meta CAPI + TikTok Events API) must actually be sent from checkout.
   Run with: npm run test:unit

   This guards against a specific past bug: the order row was created with
   `capiPurchaseSentAt: new Date()`, so the `if (!order.capiPurchaseSentAt)` guard below it was
   always false and the direct server-side Purchase never fired — only the browser-triggered
   /api/track/event copy reached Meta, and nothing reached TikTok. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app/api/checkout/route.ts'), 'utf8');

test('checkout: the order row is NOT created with capiPurchaseSentAt already stamped', () => {
  const createBlock = source.slice(source.indexOf('tx.order.create'), source.indexOf('const finalOrder'));
  assert.ok(createBlock.length > 0, 'order.create block not found');
  const withoutComments = createBlock.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/capiPurchaseSentAt\s*:/.test(withoutComments), false,
    'stamping the flag at creation makes the send-guard below always false');
});

test('checkout: the guard still stamps the flag immediately before the send', () => {
  assert.match(source, /if \(!order\.capiPurchaseSentAt\) \{[\s\S]{0,200}?capiPurchaseSentAt: new Date\(\)/,
    'the flag must be set inside the guard, before sending, so retries stay idempotent');
});

test('checkout: server-side Purchase is sent to both Meta and TikTok with the same event id', () => {
  const guard = source.slice(source.indexOf('if (!order.capiPurchaseSentAt)'));
  assert.match(guard, /sendCapi\(\{/, 'Meta CAPI Purchase missing from the checkout route');
  assert.match(guard, /sendTikTokEvent\(\{/, 'TikTok Events API Purchase missing from the checkout route');
  const metaId = /sendCapi\(\{[\s\S]*?eventId: ([^,\n]+)/.exec(guard);
  const tiktokId = /sendTikTokEvent\(\{[\s\S]*?eventId: ([^,\n]+)/.exec(guard);
  assert.ok(metaId && tiktokId, 'both calls must pass an explicit eventId');
  assert.equal(metaId[1].trim(), tiktokId[1].trim(),
    'both platforms must receive the same event id so each browser copy dedups');
});

test('track/event: every funnel event is forwarded to TikTok with the same event id', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app/api/track/event/route.ts'), 'utf8');
  assert.match(src, /sendTikTokEvent\(\{/, 'no TikTok forward');
  assert.match(src, /event: name, eventId: eventId \|\| `srv_/);
});
