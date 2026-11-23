const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

function harness(patch = {}) {
  const calls = [];
  const fixture = { code: 'ORD-1079', phone: '01602511179', area: 'OUTSIDE_DHAKA', subtotal: 1450, discount: 100, deliveryFee: 130, total: 1480, status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'PENDING', payments: [], items: [{ title: 'Denim hoodie', variant: 'L', qty: 2, price: 725, image: null, productId: 7, preorder: false, product: { images: [{ url: '/api/media/test' }] } }], ...patch };
  const { getSuccessOrder } = loader({ './db': { db: { order: { findFirst: async query => { calls.push(query); return query.where.phone === fixture.phone ? fixture : null; } } } } })('lib/success-order.ts');
  return { getSuccessOrder, calls };
}

test('receipt lookup requires a valid code AND checkout phone before accessing the database', async () => {
  const { getSuccessOrder, calls } = harness();
  for (const [code, phone] of [['ORD-1079', undefined], ['ORD-1079', 'invalid'], ['anything', '01602511179'], [['ORD-1079'], '01602511179'], ['ORD-1079', ['01602511179']]]) assert.equal(await getSuccessOrder(code, phone), null);
  assert.equal(calls.length, 0);
  assert.equal(await getSuccessOrder('ORD-1079', '01700000000'), null);
  assert.deepEqual(calls[0].where, { code: 'ORD-1079', phone: '01700000000' });
  assert.equal((await getSuccessOrder(' ord-1079 ', '+8801602511179')).phone, '01602511179');
});
test('verified receipt returns DB totals, line items and image fallback without internal relation data', async () => {
  const { getSuccessOrder } = harness();
  const order = await getSuccessOrder('ORD-1079', '01602511179');
  assert.equal(order.total, 1480);
  assert.equal(order.discount, 100);
  assert.equal(order.items[0].image, '/api/media/test');
  assert.equal('product' in order.items[0], false);
  assert.equal('payments' in order, false);
  assert.equal(order.balance, 1480);
});
test('receipt payment balance respects paid, advance, refunds and unknown legacy partial entries', async () => {
  for (const [patch, expected] of [
    [{ paymentStatus: 'PAID' }, 0],
    [{ paymentStatus: 'PARTIAL', payments: [{ amount: 300, kind: 'ADVANCE' }] }, 1180],
    [{ payments: [{ amount: 300, kind: 'ADVANCE' }, { amount: 100, kind: 'REFUND' }] }, 1280],
    [{ paymentStatus: 'PARTIAL' }, null],
    [{ payments: [{ amount: 100, kind: 'REFUND' }] }, 1480],
  ]) assert.equal((await harness(patch).getSuccessOrder('ORD-1079', '01602511179')).balance, expected);
});
test('progress never marks pending as confirmed/dispatched and suspends closed/held timelines', () => {
  const { successProgress } = loader()('lib/success-progress.ts');
  assert.equal(successProgress('PENDING').stage, 0);
  assert.equal(successProgress('PENDING').label, 'Order received');
  for (const status of ['CONFIRMED', 'PROCESSING', 'PACKED']) assert.equal(successProgress(status).stage, 1);
  assert.equal(successProgress('SHIPPED').stage, 2);
  assert.equal(successProgress('DELIVERED').stage, 3);
  for (const status of ['CANCELLED', 'RETURNED', 'ON_HOLD']) assert.equal(successProgress(status).closed, true);
});
