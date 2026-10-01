const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const load = loader({}, { NODE_ENV: 'test', SESSION_SECRET: 'recovery-unit-session-secret', CRON_SECRET: '0123456789abcdef'.repeat(4) });
const security = load('lib/recovery-security.ts');
const cart = load('lib/abandoned-cart.ts');
const client = load('lib/recovery-client.ts');
const checkout = load('lib/checkout-items.ts');
const row = { id: 1, createdAt: new Date('2026-01-01T00:00:00Z'), phone: '01712345678', email: 'buyer@example.invalid' };

test('capture identity is high-entropy, case-normalized and never a phone/id lookup', () => {
  assert.equal(security.captureKeyHash('a'.repeat(64)), security.captureKeyHash('A'.repeat(64)));
  assert.equal(security.captureKeyHash('a'.repeat(64)).length, 64);
  for (const value of [1, null, {}, row.phone, 'a'.repeat(63), 'g'.repeat(64)]) assert.equal(security.captureKeyHash(value), null);
});
test('recovery tokens are purpose-separated, signed and reject tampering/expiry', () => {
  const token = security.signRecoveryToken(row, 'COMEBACK10');
  const decoded = security.readRecoveryToken(token);
  assert.equal(decoded.id, 1); assert.equal(decoded.coupon, 'COMEBACK10');
  assert.equal(security.readRecoveryToken(token.slice(0, -2) + 'xx'), null);
  assert.equal(security.readRecoveryToken(security.signRecoveryToken(row, null, Date.now() - security.RECOVERY_LINK_TTL - 1)), null);
  const session = load('lib/session-token.ts').encodeSessionPayload({ purpose: 'customer', id: 1, exp: Date.now() + 60000 });
  assert.equal(security.readRecoveryToken(session), null);
});
test('recovery bearer is bound to the contact and record creation time', () => {
  const p = security.readRecoveryToken(security.signRecoveryToken(row));
  assert.equal(security.matchesRecoverySubject(p, row), true);
  for (const patch of [{ phone: '01812345678' }, { email: 'different@example.invalid' }, { createdAt: new Date('2026-01-02') }, { id: 2 }]) assert.equal(security.matchesRecoverySubject(p, { ...row, ...patch }), false);
});
test('recovery links use fragments, not server-log/referrer query secrets', () => {
  const link = new URL(security.recoveryUrl('https://shop.example.invalid/', 'token.value'));
  assert.equal(link.pathname, '/checkout'); assert.equal(link.search, ''); assert.equal(link.hash, '#recover=token.value');
  assert.throws(() => security.recoveryUrl('javascript:alert(1)', 'token'), /valid public/);
});
test('cron requires a strong bearer and ignores URL tokens/cookies', () => {
  const secret = '0123456789abcdef'.repeat(4);
  assert.equal(security.isRecoveryCron(new Request('https://site.invalid?token=' + secret)), false);
  assert.equal(security.isRecoveryCron(new Request('https://site.invalid', { headers: { Authorization: 'Bearer ' + secret } })), true);
  assert.equal(security.isRecoveryCron(new Request('https://site.invalid', { headers: { Authorization: 'Bearer wrong' } })), false);
});
test('phone/email cooldown identities are hashed internal settings, not exposed PII', () => {
  const keys = security.recipientKeys(row.phone, row.email);
  assert.equal(keys.length, 2); assert.ok(keys.every(key => key.startsWith('security.recovery.recipient.')));
  assert.ok(keys.every(key => !key.includes(row.phone) && !key.includes(row.email)));
});
test('capture contact normalizes international BD numbers and supports clearing email', () => {
  const c = cart.validateRecoveryContact({ name: ' Test Buyer ', phone: '+8801712345678', address: 'House 20 Road 30 Dhaka', email: ' TEST@EXAMPLE.INVALID ' });
  assert.equal(c.phone, row.phone); assert.equal(c.email, 'test@example.invalid');
  assert.equal(cart.validateRecoveryContact({ ...c, email: '' }).email, null);
  assert.throws(() => cart.validateRecoveryContact({ ...c, phone: '123' }), cart.RecoveryError);
});
test('saved snapshots require explicit delivery zone and trusted SKU references', () => {
  const raw = { version: 2, area: 'OUTSIDE_DHAKA', items: [{ productId: 1, variantId: 11, qty: 2 }], giftWrap: true, notes: 'ok', couponCode: 'back10' };
  assert.equal(cart.readSavedCart(JSON.stringify(raw)).couponCode, 'BACK10');
  assert.throws(() => cart.readSavedCart(JSON.stringify([{ title: 'Fake', qty: 2, price: 1 }])), cart.RecoveryError);
  assert.throws(() => cart.readSavedCart(JSON.stringify({ ...raw, area: 'unknown' })), cart.RecoveryError);
  assert.throws(() => cart.readSavedCart('malformed'), cart.RecoveryError);
});
test('restore uses live variant prices, caps aggregate stock and explains reductions', () => {
  const p = { id: 1, title: 'Shirt', slug: 'shirt', price: 200, stock: 3, preorder: false, images: [{ url: '/image' }], variants: [{ id: 11, size: 'M', stock: 2, price: 0 }, { id: 12, size: 'L', stock: 5, price: 220 }] };
  const saved = { items: [{ productId: 1, variantId: 11, qty: 4 }, { productId: 1, variantId: 12, qty: 2 }] };
  const r = cart.restoredLines(saved, [p]);
  assert.deepEqual(r.lines.map(l => l.qty), [2, 1]); assert.deepEqual(r.lines.map(l => l.price), [0, 220]);
  assert.equal(r.warnings.length, 2); assert.ok(r.lines.every(l => l.productId && l.variantId));
});
test('deleted/foreign variants are removed instead of guessing a different size', () => {
  const p = { id: 1, title: 'Shirt', slug: 'shirt', price: 200, stock: 10, images: [], variants: [{ id: 11, stock: 10 }] };
  assert.equal(cart.restoredLines({ items: [{ productId: 1, variantId: 99, qty: 1 }] }, [p]).lines.length, 0);
});
test('draft-only no-stock quoting cannot bypass real checkout validation', () => {
  const p = { id: 1, title: 'Shirt', price: 200, stock: 0, images: [], variants: [{ id: 11, stock: 0 }] };
  const lines = [{ productId: 1, variantId: 11, qty: 1 }];
  assert.equal(checkout.buildCheckoutItems(lines, [p], { checkStock: false }).subtotal, 200);
  assert.throws(() => checkout.buildCheckoutItems(lines, [p]), checkout.CheckoutValidationError);
});
test('email/customer HTML is escaped and recovery tokens never enter tracking URLs', () => {
  assert.equal(cart.escapeEmail('<img src=x>"&'), '&lt;img src=x&gt;&quot;&amp;');
  assert.equal(client.safeTrackingUrl('https://shop.invalid/checkout?utm_source=mail#recover=PRIVATE'), 'https://shop.invalid/checkout?utm_source=mail');
  assert.equal(client.safeTrackingUrl('https://shop.invalid/checkout?recover=PRIVATE&utm_source=mail'), 'https://shop.invalid/checkout?utm_source=mail');
});
test('browser capture revisions monotonically increase and cart comparisons ignore order', () => {
  assert.equal(client.nextCaptureRevision(), 1); assert.equal(client.nextCaptureRevision(), 2);
  assert.equal(client.captureSignature([{ productId: 2, qty: 2 }, { productId: 1, variantId: 3, qty: 1 }]), client.captureSignature([{ productId: 1, variantId: 3, qty: 1 }, { productId: 2, qty: 2 }]));
});
