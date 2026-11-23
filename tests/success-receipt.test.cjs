const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { loader } = require('./load-ts.cjs');
function receipt(orderPatch = {}) {
  let cursor = 0; const state = [];
  const order = orderPatch === null ? null : { code: 'ORD-1079', phone: '01602511179', area: 'OUTSIDE_DHAKA', subtotal: 1450, discount: 0, deliveryFee: 130, total: 1580, balance: 1580, status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'PENDING', items: [{ title: 'Denim hoodie', variant: 'L', qty: 2, price: 725, image: null }], ...orderPatch };
  const mocks = {
    react: { useState(init) { const i = cursor++; if (!(i in state)) state[i] = init; return [state[i], value => { state[i] = value; }]; } },
    'next/link': { __esModule: true, default: 'Link' },
    '@/components/push-optin': { __esModule: true, default: 'PushOptIn' },
    '@/lib/success-progress': loader()('lib/success-progress.ts'),
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/order/success/receipt.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => mocks[id] || require(id), module, module.exports);
  const nodes = () => {
    cursor = 0; const result = [];
    function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; result.push(node); walk(node.props.children); }
    walk(module.exports.default({ order, supportHref: 'https://wa.me/8801700000000' })); return result;
  };
  const textOf = node => Array.isArray(node) ? node.map(textOf).join(' ') : node?.props ? textOf(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  return { nodes, text: () => nodes().map(textOf).join(' '), find: predicate => { const node = nodes().find(predicate); assert.ok(node); return node; } };
}
test('receipt summary starts expanded and exposes accessible show/hide controls', () => {
  const ui = receipt();
  const toggle = () => ui.find(n => n.props['aria-controls'] === 'receipt-summary-body');
  assert.equal(toggle().props['aria-expanded'], true);
  assert.equal(ui.find(n => n.props.id === 'receipt-summary-body').props.hidden, false);
  toggle().props.onClick();
  assert.equal(toggle().props['aria-expanded'], false);
  assert.equal(ui.find(n => n.props.id === 'receipt-summary-body').props.hidden, true);
});
test('receipt uses real tracking/invoice/store links without propagating phone credentials', () => {
  const ui = receipt();
  for (const href of ['/track?code=ORD-1079', '/invoice/ORD-1079', '/products']) ui.find(n => n.props.href === href);
  assert.equal(ui.nodes().some(n => n.props.href?.includes('01602511179')), false);
  assert.ok(ui.text().includes('Amount payable on delivery'));
  assert.equal(ui.text().includes('Order confirmed'), false);
  assert.ok(ui.text().includes('Denim hoodie'));
});
test('paid, non-COD and legacy partial receipts do not falsely demand full COD payment', () => {
  assert.ok(receipt({ paymentStatus: 'PAID', balance: 0 }).text().includes('Paid in full'));
  assert.equal(receipt({ paymentStatus: 'PAID', balance: 0 }).text().includes('Amount payable on delivery'), false);
  assert.ok(receipt({ paymentMethod: 'BKASH' }).text().includes('Payment awaiting verification'));
  assert.ok(receipt({ paymentStatus: 'REFUNDED' }).text().includes('Payment refunded - check tracking'));
  assert.ok(receipt({ paymentStatus: 'FAILED' }).text().includes('Payment not completed'));
  assert.ok(receipt({ paymentStatus: 'PARTIAL', balance: null }).text().includes('Order total - advance recorded'));
});
test('missing credentials render a neutral recovery page without customer data or invoice links', () => {
  const ui = receipt(null);
  assert.ok(ui.text().includes('Find your order.'));
  assert.equal(ui.text().includes('Thank you for'), false);
  assert.equal(ui.nodes().some(n => n.props.href?.startsWith('/invoice/')), false);
  assert.equal(ui.nodes().some(n => n.type === 'PushOptIn'), false);
});
test('closed orders omit forward progress and never promise dispatch', () => {
  const ui = receipt({ status: 'CANCELLED' });
  assert.equal(ui.nodes().some(n => n.props['aria-label'] === 'Order progress'), false);
  assert.ok(ui.text().includes('Order cancelled'));
  assert.equal(ui.text().includes('to confirm the details'), false);
});
