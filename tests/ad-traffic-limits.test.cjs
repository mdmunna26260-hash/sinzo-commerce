/* Ad-traffic safety: the per-IP limits must be sized for carrier-grade NAT.
   Run with: npm run test:unit

   In Bangladesh most mobile traffic arrives through CGNAT — hundreds of shoppers share one
   public IP. A limit that is right for one person is therefore wrong for the key it uses.
   These assert the floors we decided on; if a future change lowers one, the checkout starts
   answering "Too many attempts" to paying customers mid-campaign. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function limit(source, key) {
  const m = new RegExp(`rateLimit\\("${key}"[^]*?,\\s*(\\d+),\\s*([\\d_ *]+)\\)`).exec(source);
  return m ? { max: Number(m[1]), window: m[2] } : null;
}

test('checkout order POST: per-IP cap is above a busy campaign hour, per-phone cap exists', () => {
  const src = read('app/api/checkout/route.ts');
  const ip = limit(src, 'checkout:');
  assert.ok(ip, 'per-IP checkout limit missing');
  assert.ok(ip.max >= 120, `per-IP checkout cap is ${ip.max}; 10 was already too low for CGNAT`);
  const phone = limit(src, 'checkout-phone:');
  assert.ok(phone, 'the per-phone limit is what actually stops order spam');
  assert.ok(phone.max <= 5, 'one phone placing more than 5 orders in 10 minutes is not a customer');
});

test('checkout autosave: per-IP cap covers several customers behind one NAT', () => {
  const src = read('app/api/checkout/start/route.ts');
  const ip = limit(src, 'checkout-start:');
  assert.ok(ip, 'autosave limit missing');
  assert.ok(ip.max >= 200, `autosave cap is ${ip.max}; one shopper emits 10-15 calls`);
});

test('analytics events: a throttled event is a conversion the ad platform never sees', () => {
  const src = read('app/api/track/event/route.ts');
  const ip = limit(src, 'event:');
  assert.ok(ip, 'event limit missing');
  assert.ok(ip.max >= 600, `event cap is ${ip.max} per IP per minute`);
});

test('coupon apply: burst stays tight, hourly cap is NAT-sized', () => {
  const src = read('app/api/coupon/route.ts');
  const burst = Number(/BURST_MAX = (\d+)/.exec(src)[1]);
  const hour = Number(/HOURLY_MAX = (\d+)/.exec(src)[1]);
  assert.ok(burst <= 10, 'the one-minute burst is the real brute-force guard — keep it tight');
  assert.ok(hour >= 150, `hourly coupon cap is ${hour}; customers sharing an IP hit it`);
});

test('public catalogue APIs are CDN-cacheable (they were no-store on every visitor)', () => {
  for (const f of ['app/api/gift-rule/route.ts', 'app/api/combo-bundles/route.ts']) {
    const src = read(f);
    assert.match(src, /s-maxage=\d+/, `${f} has no shared cache lifetime`);
    assert.doesNotMatch(src, /"private, no-store"/, `${f} still opts out of every cache`);
  }
});
