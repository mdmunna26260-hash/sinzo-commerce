const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { loader } = require('./load-ts.cjs');
const workflow = loader()('lib/admin-workflow.ts');

test('ready-to-send queue excludes booked, shipped, held and closed orders', () => {
  for (const status of ['CONFIRMED', 'PROCESSING', 'PACKED']) {
    assert.equal(workflow.isReadyToSend({ status }), true);
    assert.equal(workflow.isReadyToSend({ status, courierConsignmentId: '' }), true);
    assert.equal(workflow.isReadyToSend({ status, courierConsignmentId: '123' }), false);
  }
  for (const status of ['PENDING', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'RETURNED']) assert.equal(workflow.isReadyToSend({ status }), false);
  assert.deepEqual(workflow.workflowQueue('READY', 'ready').where, workflow.readyToSendWhere());
  assert.equal(workflow.workflowQueue('ALL', 'ready'), null);
  assert.equal(workflow.workflowQueue('READY', ['ready']), null);
  assert.deepEqual(workflow.workflowQueue('PENDING', 'pending').where, { status: 'PENDING' });
  assert.deepEqual(workflow.workflowQueue('ON_HOLD', 'hold').where, { status: 'ON_HOLD' });
});
test('workflow preview links preserve filters and anchors without leaking tokens externally', () => {
  assert.equal(workflow.adminWorkflowHref('/admin/orders?tab=READY&queue=ready', 'token/+'), '/admin/orders?tab=READY&queue=ready&t=token%2F%2B');
  assert.equal(workflow.adminWorkflowHref('/admin/stock?attention=1#stock-restock', 'x'), '/admin/stock?attention=1&t=x#stock-restock');
  for (const href of ['/', 'https://outside.test/admin/orders', '//outside.test/admin/orders']) assert.equal(workflow.adminWorkflowHref(href, 'private'), href);
});
function countsHarness(fail = false) {
  const calls = [], lowStockField = { field: 'lowStock' };
  const db = {
    order: { count: async query => { calls.push(['order', query]); if (fail) throw Error('DB unavailable'); return query.where.status === 'PENDING' ? 11 : query.where.status === 'ON_HOLD' ? 3 : 8; } },
    product: { fields: { lowStock: lowStockField }, count: async query => { calls.push(['product', query]); return 17; } },
  };
  return { ...loader({ './db': { db } })('lib/dashboard-work.ts'), calls, lowStockField };
}
test('dashboard uses uncapped counts and each product alert level, not a six-row preview or fixed threshold', async () => {
  const ui = countsHarness();
  assert.deepEqual(await ui.dashboardWork({ orders: true, products: true }), { pending: 11, ready: 8, hold: 3, stock: 17 });
  const query = ui.calls.find(([kind]) => kind === 'product')[1];
  assert.equal(query.where.status, 'ACTIVE');
  assert.equal(query.where.stock.lte, ui.lowStockField);
  assert.equal('take' in query, false);
});
test('unauthorized queues are never queried and a failed count is not reported as zero', async () => {
  const ui = countsHarness(true);
  assert.deepEqual(await ui.dashboardWork({ orders: true, products: false }), { pending: null, ready: null, hold: null, stock: null });
  assert.equal(ui.calls.some(([kind]) => kind === 'product'), false);
  const none = countsHarness();
  await none.dashboardWork({ orders: false, products: false });
  assert.equal(none.calls.length, 0);
});
function workCards(productsAllowed, patch = {}) {
  const module = { exports: {} };
  const mocks = { 'next/link': { __esModule: true, default: 'Link' }, '@/lib/admin-workflow': workflow };
  const compiled = ts.transpileModule(fs.readFileSync('components/admin/dashboard-work.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => mocks[id] || require(id), module, module.exports);
  const nodes = [];
  const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n?.props) return; nodes.push(n); walk(n.props.children); };
  walk(module.exports.default({ counts: { pending: 4, ready: 7, hold: 2, stock: 17, ...patch }, productsAllowed, token: 'preview' }));
  return nodes;
}
test('dashboard links open matching queues and hide product actions from order-only staff', () => {
  const nodes = workCards(true);
  const links = nodes.filter(n => n.type === 'Link');
  assert.ok(links.some(n => n.props.href === '/admin/orders?tab=READY&queue=ready&t=preview'));
  assert.ok(links.some(n => n.props.href === '/admin/products?new=1&t=preview'));
  const restricted = workCards(false);
  assert.equal(restricted.some(n => /\/admin\/(products|stock)/.test(n.props.href || '')), false);
  assert.ok(restricted.some(n => n.props.href?.includes('queue=pending')));
});
test('unknown queue counts display unavailable, never an all-clear message', () => {
  const nodes = workCards(true, { pending: null, ready: 0, hold: 0, stock: 0 });
  assert.ok(nodes.some(n => n.props['aria-label'] === 'Pending orders: count unavailable'));
  assert.ok(nodes.some(n => n.props.role === 'status' && n.props.children.includes('could not load')));
});
