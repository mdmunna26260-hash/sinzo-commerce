const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { orderWhatsAppMessage } = loader()('lib/order-whatsapp.ts');
const order = { code: 'ORD-1001', status: 'CONFIRMED', items: [{ title: 'Linen Shirt', variant: 'Black / XL', qty: 2 }] };

test('confirmed WhatsApp draft includes product, variant, quantity and order code', () => {
  const message = orderWhatsAppMessage(order);
  assert.ok(message.includes('"Linen Shirt (Black / XL) x2" order ta confirmed kora hoyeche.'));
  assert.ok(message.includes('Order ID: ORD-1001'));
});
test('multiple items and reserved URL characters survive a prefilled WhatsApp URL', () => {
  const message = orderWhatsAppMessage({ ...order, items: [{ title: 'Black & White #1', qty: 1 }, { title: 'Shirt + Pants', qty: 2 }] });
  const url = new URL('https://wa.me/8801700000000?text=' + encodeURIComponent(message));
  assert.equal(url.searchParams.get('text'), message);
  assert.ok(message.includes('Black & White #1 x1, Shirt + Pants x2'));
});
test('nonconfirmed orders never claim to be confirmed', () => {
  for (const status of ['PENDING', 'CANCELLED', 'RETURNED', 'ON_HOLD', 'DELIVERED', 'SHIPPED', 'OTHER']) {
    assert.equal(orderWhatsAppMessage({ ...order, status }).includes('confirmed kora hoyeche'), false);
  }
  assert.ok(orderWhatsAppMessage({ ...order, status: 'CANCELLED' }).includes('cancel kora hoyeche'));
});
