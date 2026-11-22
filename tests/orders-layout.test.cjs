const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Exercise the actual component's filters and selection with a minimal hook host.
// CSS breakpoints still require a browser visual check; these are behavior tests.
function screen(initialTab = 'ALL', options = {}) {
  const state = []; let cursor = 0;
  const pushed = [];
  const module = { exports: {} };
  const mocks = {
    react: {
      useState(init) { const i = cursor++; if (!(i in state)) state[i] = typeof init === 'function' ? init() : init; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
      useMemo: fn => fn(),
      useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; },
      useEffect: () => {},
    },
    'next/link': { __esModule: true, default: 'Link' },
    'next/navigation': { useRouter: () => ({ push: url => pushed.push(url), refresh() {} }) },
    '@/lib/escape-html': require('./load-ts.cjs').loader()('lib/escape-html.ts'),
    '@/lib/order-whatsapp': require('./load-ts.cjs').loader()('lib/order-whatsapp.ts'),
    '@/components/dates': { FmtDate: 'FmtDate' },
    '@/lib/afetch': { withToken: url => url + '?t=preview', copyText: async () => true, afetch: options.request || (async () => { throw new Error('Unexpected API call'); }) },
    '@/lib/phone': { telLink: phone => 'tel:' + phone, waLink: phone => 'https://wa.me/' + phone },
  };
  const compiled = ts.transpileModule(fs.readFileSync('app/admin/(panel)/orders/client.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', 'confirm', 'alert', compiled)(id => mocks[id] || require(id), module, module.exports, () => options.confirmResult !== false, message => options.alert?.(message));
  const base = { phone: '01712345678', address: 'Dhaka', area: 'INSIDE_DHAKA', total: 1200, paymentMethod: 'COD', riskLevel: 'LOW', createdAt: new Date().toISOString() };
  const initial = [
    { ...base, id: 1, code: 'ORD-1', name: 'Customer One', status: 'PENDING', paymentStatus: 'PENDING', items: [{ title: 'Very long product title', variant: 'Black / XL', image: '/api/media/test-image', qty: 2 }] },
    { ...base, id: 2, code: 'ORD-2', name: 'Customer Two', status: 'DELIVERED', paymentStatus: 'PAID', courierConsignmentId: 'TRACK-222', items: [{ title: 'Preorder item', qty: 1, preorder: true }] },
  ];
  const nodes = () => {
    cursor = 0;
    const root = module.exports.default({ initial, initialTab });
    const out = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object' || !node.props) return;
      out.push(node); walk(node.props.children);
    }
    walk(root); return out;
  };
  return {
    nodes, pushed,
    find: predicate => { const node = nodes().find(predicate); assert.ok(node, 'Expected matching element'); return node; },
    cards: () => nodes().filter(n => n.type === 'article').map(n => n.props['aria-label']),
  };
}

test('orders render readable mobile cards alongside the desktop table and collapsed extra filters', () => {
  const ui = screen();
  assert.deepEqual(ui.cards(), ['Order ORD-1', 'Order ORD-2']);
  assert.equal(ui.find(n => n.props.id === 'orders-extra-filters').props.hidden, true);
  ui.find(n => n.type === 'table');
  ui.find(n => n.type === 'small' && n.props.children === 'Black / XL');
  ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One');
  ui.find(n => n.props['aria-label'] === 'Call customer for ORD-1');
  assert.equal(ui.find(n => n.props['aria-label'] === 'View ORD-1 for Customer One').props.href, '/admin/orders/1?t=preview');
});
test('search matches customer and consignment while preserving the search input value', () => {
  const ui = screen();
  const input = () => ui.find(n => n.props.type === 'search');
  input().props.onChange({ target: { value: 'customer one' } });
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  input().props.onChange({ target: { value: 'TRACK-222' } });
  assert.deepEqual(ui.cards(), ['Order ORD-2']);
});
test('status buttons and PREORDER deep links apply the expected order filters', () => {
  const ui = screen();
  const tabs = () => ui.nodes().filter(n => n.type === 'button' && n.props.className?.startsWith('orders-status-tab'));
  tabs()[1].props.onClick();
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  assert.equal(tabs()[1].props['aria-pressed'], true);
  assert.deepEqual(screen('PREORDER').cards(), ['Order ORD-2']);
  assert.equal(screen('INVALID').cards().length, 2);
});
test('extra filters expand and payment/date filters combine without expanding the header by default', () => {
  const ui = screen();
  ui.find(n => n.props['aria-controls'] === 'orders-extra-filters').props.onClick();
  assert.equal(ui.find(n => n.props.id === 'orders-extra-filters').props.hidden, false);
  const selects = ui.nodes().filter(n => n.type === 'select');
  selects[0].props.onChange({ target: { value: 'PAID' } });
  assert.deepEqual(ui.cards(), ['Order ORD-2']);
  ui.nodes().filter(n => n.type === 'select')[1].props.onChange({ target: { value: 'yesterday' } });
  assert.deepEqual(ui.cards(), []);
  ui.find(n => n.type === 'button' && n.props.children === 'Reset filters').props.onClick();
  assert.equal(ui.cards().length, 2);
});
test('card selection exposes bulk actions and select-all shares state with the table', () => {
  const ui = screen();
  assert.equal(ui.nodes().some(n => n.type === 'fieldset'), false);
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  ui.find(n => n.type === 'fieldset');
  assert.equal(ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.checked, true);
  assert.deepEqual(ui.pushed, []);
  ui.find(n => n.props['aria-label'] === 'Select all matching orders').props.onChange();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Select all matching orders in table').props.checked, true);
  ui.find(n => n.type === 'button' && n.props.children === 'Clear selection').props.onClick();
  assert.equal(ui.nodes().some(n => n.type === 'fieldset'), false);
});

test('cards render image thumbnails with a broken-image placeholder fallback and WP/Call links', () => {
  const ui = screen();
  const image = ui.find(n => n.type === 'img');
  assert.equal(image.props.src, '/api/media/test-image/w80');
  const target = { hidden: false }; image.props.onError({ currentTarget: target });
  assert.equal(target.hidden, true);
  const wp = ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One');
  assert.ok(wp.props.href.startsWith('https://wa.me/'));
  assert.ok(wp.props.href.includes('ORD-1'));
  assert.equal(wp.props.href.includes('?t='), false);
  assert.equal(ui.find(n => n.props['aria-label'] === 'Call customer for ORD-1').props.href, 'tel:01712345678');
  assert.equal(ui.nodes().some(n => n.props['aria-label'] === 'Copy phone for ORD-1'), false);
});
test('sent orders show their consignment next to the order code and cannot be sent again', () => {
  const ui = screen();
  const cid = ui.find(n => n.props.className === 'order-mobile-consignment');
  assert.ok(cid.props.children.includes('TRACK-222'));
  const sends = ui.nodes().filter(n => n.props.className === 'abtn order-send');
  assert.equal(sends[0].props.disabled, false);
  assert.equal(sends[1].props.disabled, true);
});
test('courier send uses the existing endpoint only after confirmation and immediately shows the returned id', async () => {
  const calls = [];
  const ui = screen('ALL', { request: async (url, opts) => {
    calls.push([url, opts.method]);
    return { ok: true, json: async () => ({ ok: true, consignment: { consignment_id: 789123, delivery_status: 'in_review' } }) };
  } });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  assert.deepEqual(calls, [['/api/admin/orders/1/courier', 'POST']]);
  assert.ok(ui.nodes().filter(n => n.props.className === 'order-mobile-consignment').some(n => n.props.children.includes('789123')));
  assert.equal(ui.find(n => n.props.className === 'abtn order-send').props.disabled, true);
});
test('mini status control uses the inventory-aware order update endpoint and updates status filters', async () => {
  const calls = [];
  const ui = screen('PENDING', { request: async (url, opts) => {
    calls.push([url, opts.method, JSON.parse(opts.body)]);
    return { ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED', paymentStatus: 'PENDING' } }) };
  } });
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CONFIRMED' } });
  assert.deepEqual(calls, [['/api/admin/orders/1', 'PUT', { status: 'CONFIRMED' }]]);
  assert.deepEqual(ui.cards(), []);
});
test('cancelled confirmations never call the courier or status APIs', async () => {
  const ui = screen('ALL', { confirmResult: false });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CANCELLED' } });
  assert.equal(ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.value, 'PENDING');
});
test('failed fulfillment actions show an error and do not falsely change status or mark courier sent', async () => {
  const ui = screen('ALL', { request: async () => ({ ok: false, json: async () => ({ error: 'Inventory conflict' }) }) });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  assert.equal(ui.find(n => n.props.className === 'abtn order-send').props.disabled, false);
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'DELIVERED' } });
  assert.equal(ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.value, 'PENDING');
  ui.find(n => n.props.role === 'alert');
});


test('WP draft includes products and follows the latest saved order status', async () => {
  const ui = screen('ALL', { request: async () => ({ ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED', paymentStatus: 'PENDING' } }) }) });
  const draft = () => new URL(ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One').props.href).searchParams.get('text');
  assert.ok(draft().includes('Very long product title (Black / XL) x2'));
  assert.equal(draft().includes('confirmed kora hoyeche'), false);
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CONFIRMED' } });
  assert.ok(draft().includes('confirmed kora hoyeche'));
  assert.ok(draft().includes('Order ID: ORD-1'));
});

test('bulk courier network failures release the shared mutation lock for retry', async () => {
  let attempts = 0; const alerts = [];
  const ui = screen('ALL', { request: async () => { attempts++; throw new Error('Offline'); }, alert: message => alerts.push(message) });
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  await ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  assert.equal(ui.find(n => n.type === 'fieldset').props.disabled, false);
  await ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  assert.equal(attempts, 2);
  assert.equal(alerts.length, 2);
});
test('an in-flight bulk courier request blocks a second booking action', async () => {
  let finish; let calls = 0;
  const ui = screen('ALL', { request: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  const pending = ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ sent: 1, failed: 0 }) });
  await pending;
});
