const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { loader } = require('./load-ts.cjs');
function screen(options = {}) {
  let cursor = 0; const state = [], calls = [], effects = [];
  const initial = { id: 1, code: 'ORD-1001', name: 'Buyer', phone: '01700000000', address: 'Road 10, Dhaka', area: 'INSIDE_DHAKA', status: 'PENDING', paymentStatus: 'PENDING', paymentMethod: 'COD', total: 1080, subtotal: 1000, deliveryFee: 80, discount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), riskLevel: 'LOW', items: [{ id: 1, title: 'Cotton shirt', price: 1000, qty: 1 }] };
  const mocks = {
    react: {
      useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
      useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; },
      useEffect(fn, deps) { effects.push([fn, deps]); },
    },
    'next/link': { __esModule: true, default: 'Link' },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/components/dates': { FmtDate: 'FmtDate' },
    '@/lib/phone': loader()('lib/phone.ts'),
    '@/lib/order-whatsapp': loader()('lib/order-whatsapp.ts'),
    '@/lib/afetch': { withToken: x => x, copyText: async () => true, afetch: async (url, opts) => { calls.push([url, opts]); if (options.request) return options.request(url, opts); throw Error('Network offline'); } },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/admin/(panel)/orders/[id]/client.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', 'confirm', compiled + '\nmodule.exports.__PaymentsCard = PaymentsCard;')(id => mocks[id] || require(id), module, module.exports, () => options.confirm !== false);
  const nodes = () => {
    cursor = 0; effects.length = 0;
    const result = [];
    const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n?.props) return; result.push(n); walk(n.props.children); };
    walk(options.payments ? module.exports.__PaymentsCard({ orderId: 1, total: 1080, paymentStatus: 'PENDING', canMutate: () => options.allowPayment !== false, onBusyChange() {}, onSaved() {} }) : module.exports.default({ initial })); return result;
  };
  return { nodes, calls, effects, find(fn) { const n = nodes().find(fn); assert.ok(n, 'Expected element'); return n; } };
}
test('mobile order summary has real contact and address-copy controls, with manual confirmation', async () => {
  const ui = screen({ confirm: false });
  ui.find(n => n.props['aria-label'] === 'Customer and delivery summary');
  ui.find(n => n.props.children === 'Copy address');
  ui.find(n => n.props.href === 'tel:+8801700000000');
  await ui.find(n => n.props.children === 'Confirm order').props.onClick();
  assert.equal(ui.calls.length, 0);
});
test('failed confirmation releases busy state and does not falsely update the order', async () => {
  const ui = screen();
  await ui.find(n => n.props.children === 'Confirm order').props.onClick();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.find(n => n.props['aria-label'] === 'Order status').props.value, 'PENDING');
  assert.equal(ui.find(n => n.props.children === 'Confirm order').props.disabled, false);
  ui.find(n => n.props.role === 'alert');
});
test('failed customer save preserves the editor and draft; status changes cannot discard drafts', async () => {
  const ui = screen();
  ui.find(n => n.props.children === 'Edit').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Customer name').props.onChange({ target: { value: 'Edited Buyer' } });
  await ui.find(n => n.props.children === 'Save').props.onClick();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Customer name').props.value, 'Edited Buyer');
  assert.equal(ui.find(n => n.props.children === 'Save changes').props.disabled, false);
  await ui.find(n => n.props['aria-label'] === 'Order status').props.onChange({ target: { value: 'DELIVERED' } });
  assert.equal(ui.calls.length, 1);
  assert.ok(ui.effects.some(([, deps]) => deps?.length === 1 && deps[0] === true));
});
test('successful customer save uses normalized server data and clears the dirty state', async () => {
  const ui = screen({ request: async () => ({ ok: true, json: async () => ({ ok: true, order: { name: 'Saved Buyer', phone: '01700000000', address: 'Road 10, Dhaka' } }) }) });
  ui.find(n => n.props.children === 'Edit').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Customer name').props.onChange({ target: { value: ' Saved Buyer ' } });
  await ui.find(n => n.props.children === 'Save').props.onClick();
  assert.equal(ui.nodes().some(n => n.props['aria-label'] === 'Customer name'), false);
  ui.find(n => n.props.children === 'Confirm order');
});
test('in-flight mutation lock blocks a duplicate confirmation', async () => {
  let finish;
  const ui = screen({ request: async () => new Promise(resolve => { finish = resolve; }) });
  const button = ui.find(n => n.props.children === 'Confirm order');
  const pending = button.props.onClick();
  await button.props.onClick();
  assert.equal(ui.calls.length, 1);
  finish({ ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED' } }) });
  await pending;
  ui.find(n => n.props.children === 'Send courier');
});

test('failed payment save releases its lock and preserves entered money for review/retry', async () => {
  const ui = screen({ payments: true });
  ui.find(n => n.props['aria-label'] === 'Payment amount').props.onChange({ target: { value: '200' } });
  await ui.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(ui.find(n => n.props['aria-label'] === 'Payment amount').props.value, '200');
  assert.equal(ui.find(n => n.props.type === 'submit').props.disabled, false);
  await ui.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls.length, 2);
});
test('payment mutations respect the shared order draft/mutation guard', async () => {
  const ui = screen({ payments: true, allowPayment: false });
  await ui.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls.length, 0);
});
