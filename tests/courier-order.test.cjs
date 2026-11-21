const { test } = require('node:test');
const assert = require('node:assert/strict');
const { courierCollectAmount } = require('./load-ts.cjs').loader()('lib/courier-order.ts');
test('courier collects only remaining money, never a prepaid bill twice', () => {
  assert.equal(courierCollectAmount({ total: 1200 }), 1200);
  assert.equal(courierCollectAmount({ total: 1200, paymentStatus: 'PAID' }), 0);
  assert.equal(courierCollectAmount({ total: 1200, paymentStatus: 'PARTIAL', payments: [{ amount: 250, kind: 'ADVANCE' }] }), 950);
  assert.equal(courierCollectAmount({ total: 1200, payments: [{ amount: 1400, kind: 'DUE' }] }), 0);
  assert.equal(courierCollectAmount({ total: 1200, payments: [{ amount: 400, kind: 'ADVANCE' }, { amount: 100, kind: 'REFUND' }] }), 900);
  assert.equal(courierCollectAmount({ total: 1200, payments: [{ amount: 100, kind: 'REFUND' }] }), 1200);
});
test('courier rejects closed orders and ambiguous or invalid financial data', () => {
  for (const status of ['DELIVERED', 'CANCELLED', 'RETURNED']) assert.throws(() => courierCollectAmount({ total: 100, status }), /cannot be sent/);
  assert.throws(() => courierCollectAmount({ total: 100, paymentStatus: 'PARTIAL' }), /Record the advance/);
  for (const total of [NaN, Infinity, -1]) assert.throws(() => courierCollectAmount({ total }), /Invalid/);
  assert.throws(() => courierCollectAmount({ total: 100, payments: [{ amount: NaN, kind: 'ADVANCE' }] }), /Invalid/);
});

test('Steadfast client passes the remaining balance and refuses closed orders before network access', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ consignment: { consignment_id: 42 } }) }; };
    const api = require('./load-ts.cjs').loader({ './settings': {
      getSettings: async () => ({ courier: { apiUrl: 'https://courier.invalid', apiKey: 'test', secretKey: 'test' } }), envFallback: s => s,
    } })('lib/steadfast.ts');
    assert.equal((await api.createConsignment({ total: 1200, status: 'DELIVERED' })).ok, false);
    assert.equal(calls.length, 0);
    assert.equal((await api.createConsignment({ total: 1200, payments: [{ amount: 300, kind: 'ADVANCE' }] })).ok, true);
    assert.equal(calls[0].cod_amount, 900);
    await api.createConsignment({ total: 1200, paymentStatus: 'PAID' });
    assert.equal(calls[1].cod_amount, 0);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 404, message: 'Consignment not found' }) });
    for (const check of [api.checkStatusByConsignment, api.checkStatusByTracking]) {
      const result = await check('42');
      assert.equal(result.ok, false);
      assert.equal(result.error, 'Consignment not found');
    }
  } finally { global.fetch = originalFetch; }
});
