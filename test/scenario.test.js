// End-to-end walk through the Brightloop month via the HTTP API. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server/app');

let base;
async function call(token, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1]} ${a[2]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const login = async (email, password) => (await ok(null, 'POST', '/api/auth/login', { email, password })).token;
const step = name => console.log('  ✓', name);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brightloop-test-'));
  const { server, port } = await start({ dataDir: dir });
  base = `http://127.0.0.1:${port}`;
  try {
    const anita = await login('anita@brightloop.in', 'Admin@123');
    const rahul = await login('rahul@brightloop.in', 'Staff@123');
    const meera = await login('meera@brightloop.in', 'Staff@123');
    const malabar = await login('accounts@malabarlogistics.in', 'Malabar@123');

    // Access control is enforced by the API, not just the menu.
    assert.strictEqual((await call(rahul, 'GET', '/api/users')).status, 403);
    assert.strictEqual((await call(rahul, 'POST', '/api/discounts', { code: 'X', type: 'percent', value: 5 })).status, 403);
    assert.strictEqual((await call(malabar, 'GET', '/api/products')).status, 403);
    assert.strictEqual((await call(null, 'GET', '/api/plans')).status, 401);
    const rahulPerms = (await ok(rahul, 'GET', '/api/me')).permissions;
    const meeraPerms = (await ok(meera, 'GET', '/api/me')).permissions;
    assert.strictEqual(rahulPerms.payments, 'view');
    assert.strictEqual(meeraPerms.payments, 'full');
    step('tab access: defaults, overrides and API enforcement');

    // Kochi Bakes signs up; weak password and duplicate email are rejected.
    assert.strictEqual((await call(null, 'POST', '/api/auth/signup', { company: 'X', name: 'X', email: 'a@b.in', password: 'weak' })).status, 400);
    assert.strictEqual((await call(null, 'POST', '/api/auth/signup', { company: 'X', name: 'X', email: 'rahul@brightloop.in', password: 'Good@1234' })).status, 409);
    const kochi = (await ok(null, 'POST', '/api/auth/signup', { company: 'Kochi Bakes', name: 'Kochi Bakes', email: 'hello@kochibakes.in', password: 'Bakes@123' })).token;
    const plans = await ok(kochi, 'GET', '/api/plans');
    const starter = plans.find(p => p.name === 'Creator Kit Monthly');
    const yearly = plans.find(p => p.name === 'Pro Camera Yearly');
    let kSub = await ok(kochi, 'POST', '/api/portal/subscribe', { plan_id: starter.id, quantity: 1, start_date: '2026-11-01' });
    assert.strictEqual(kSub.state, 'draft');
    step('Kochi Bakes self sign-up, draft subscription');

    // Rahul requests VOLUME10; Anita approves; the discount appears automatically.
    const products = await ok(rahul, 'GET', '/api/products');
    const crm = products.find(p => p.name.startsWith('Lumen X1'));
    assert.strictEqual((await call(rahul, 'POST', '/api/requests/1/approve', {})).status, 404);
    const reqId = (await ok(rahul, 'POST', '/api/requests', { type: 'discount', submit: true, title: 'Volume discount for Malabar',
      payload: { code: 'VOLUME10', type: 'percent', value: 10, min_qty: 20, start_date: '2026-11-01', end_date: '2026-12-31', usage_limit: 50, product_id: crm.id } })).id;
    assert.strictEqual((await call(rahul, 'POST', `/api/requests/${reqId}/approve`, {})).status, 403);
    const appr = await ok(anita, 'POST', `/api/requests/${reqId}/approve`, { comment: 'OK for 25 seats' });
    assert.match(appr.result, /VOLUME10/);
    assert.ok((await ok(anita, 'GET', '/api/discounts')).find(d => d.code === 'VOLUME10'));
    step('discount request approved -> VOLUME10 created automatically');

    // Quote from template.
    const tpl = (await ok(rahul, 'GET', '/api/templates')).find(t => t.name === 'Studio Fleet Yearly');
    const custs = await ok(rahul, 'GET', '/api/customers');
    const mal = custs.find(c => c.name === 'Malabar Logistics');
    assert.strictEqual((await call(rahul, 'POST', `/api/templates/${tpl.id}/quote`, { customer_id: mal.id, quantity: 3 })).status, 400); // min qty 5
    const quote = await ok(rahul, 'POST', `/api/templates/${tpl.id}/quote`, { customer_id: mal.id, quantity: 25, start_date: '2026-11-01', discount_code: 'VOLUME10' });
    assert.strictEqual(quote.state, 'quotation');
    assert.strictEqual(quote.quote_valid_until, '2026-11-15');
    // Malabar accepts in the portal; Kochi Bakes cannot touch it.
    assert.strictEqual((await call(kochi, 'POST', `/api/subscriptions/${quote.id}/accept`)).status, 403);
    const accepted = await ok(malabar, 'POST', `/api/subscriptions/${quote.id}/accept`);
    assert.strictEqual(accepted.state, 'confirmed');
    kSub = await ok(rahul, 'POST', `/api/subscriptions/${kSub.id}/confirm`);
    step(`quote ${quote.number} accepted -> confirmed`);

    // Price lock: plan with subscriptions needs a new version.
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-01' });
    assert.strictEqual((await ok(anita, 'GET', `/api/subscriptions/${quote.id}`)).state, 'active');
    assert.strictEqual((await call(anita, 'PUT', `/api/plans/${yearly.id}`, { price: 13000 })).status, 409);
    step('subscriptions active on 1 Nov; locked plan price refused');

    // Billing day.
    const run1 = await ok(meera, 'POST', '/api/billing/run');
    assert.strictEqual(run1.created.length, 2);
    const run2 = await ok(meera, 'POST', '/api/billing/run');
    assert.strictEqual(run2.created.length, 0);
    const invs = await ok(meera, 'GET', '/api/invoices');
    const malInv = invs.find(i => i.customer === 'Malabar Logistics');
    const kInv = invs.find(i => i.customer === 'Kochi Bakes');
    assert.strictEqual(malInv.subtotal, 314000);
    assert.strictEqual(malInv.discount_amount, 31400);
    assert.strictEqual(malInv.taxable, 282600);
    assert.strictEqual(malInv.tax_amount, 50868);
    assert.strictEqual(malInv.total, 333468);
    assert.strictEqual(kInv.total, 1178.82);
    assert.strictEqual(kInv.tax_amount, 179.82);
    assert.strictEqual((await ok(anita, 'GET', '/api/discounts')).find(d => d.code === 'VOLUME10').usage_count, 1);
    const subs = await ok(anita, 'GET', '/api/subscriptions');
    assert.strictEqual(subs.find(s => s.id === kSub.id).next_invoice_date, '2026-12-01');
    assert.strictEqual(subs.find(s => s.id === quote.id).next_invoice_date, '2027-11-01');
    step(`billing: ${malInv.number} ₹3,33,468 and ${kInv.number} ₹1,178.82; rerun creates nothing`);

    // Customers cannot see drafts; confirm and send.
    assert.strictEqual((await ok(malabar, 'GET', '/api/invoices')).length, 0);
    assert.strictEqual((await call(meera, 'POST', '/api/payments', { invoice_id: kInv.id, amount: 10, method: 'UPI' })).status, 400);
    for (const i of [malInv, kInv]) { await ok(meera, 'POST', `/api/invoices/${i.id}/confirm`); await ok(meera, 'POST', `/api/invoices/${i.id}/send`); }
    assert.strictEqual((await ok(malabar, 'GET', '/api/invoices')).length, 1);
    assert.strictEqual((await call(malabar, 'GET', `/api/invoices/${kInv.id}`)).status, 403);
    step('invoices confirmed and sent; portal shows own invoices only');

    // Payments.
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-03' });
    assert.strictEqual((await call(rahul, 'POST', '/api/payments', { invoice_id: kInv.id, amount: 1178.82, method: 'UPI' })).status, 403);
    await ok(meera, 'POST', '/api/payments', { invoice_id: kInv.id, amount: 1178.82, method: 'UPI', date: '2026-11-03' });
    assert.strictEqual((await ok(meera, 'GET', `/api/invoices/${kInv.id}`)).state, 'paid');
    assert.strictEqual((await call(meera, 'POST', '/api/payments', { invoice_id: malInv.id, amount: 400000, method: 'Bank transfer' })).status, 400);
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-20' });
    await ok(meera, 'POST', '/api/payments', { invoice_id: malInv.id, amount: 200000, method: 'Bank transfer', date: '2026-11-20', note: 'Part payment, PO #7781' });
    const mi = await ok(meera, 'GET', `/api/invoices/${malInv.id}`);
    assert.strictEqual(mi.balance, 133468);
    assert.strictEqual(mi.due_date, '2026-12-01');
    step('payments: Kochi paid; Malabar ₹1,33,468 outstanding; overpayment refused');

    // Pause in December.
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-12-02' });
    assert.strictEqual((await ok(meera, 'GET', `/api/invoices/${malInv.id}`)).status, 'overdue');
    const pr = (await ok(kochi, 'POST', '/api/requests', { type: 'sub_pause', submit: true, payload: { subscription_id: kSub.id } })).id;
    assert.strictEqual((await call(malabar, 'POST', '/api/requests', { type: 'sub_pause', submit: true, payload: { subscription_id: quote.id } })).status, 400); // not pausable
    await ok(rahul, 'POST', `/api/requests/${pr}/approve`, {});
    assert.strictEqual((await ok(kochi, 'GET', `/api/subscriptions/${kSub.id}`)).state, 'paused');
    const run3 = await ok(meera, 'POST', '/api/billing/run');
    assert.strictEqual(run3.created.length, 0);
    step('Dec 2: Malabar overdue; Kochi pause approved by staff; paused subscription not billed');

    // Dashboard.
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-30' });
    const dash = await ok(anita, 'GET', '/api/dashboard?from=2026-11-01&to=2026-11-30');
    assert.strictEqual(dash.outstanding, 133468);
    assert.strictEqual(dash.revenue_collected, 201178.82);
    assert.strictEqual(dash.active_subscriptions, 1); // Kochi is paused
    assert.strictEqual(dash.mrr, 23550);
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-12-02' });
    assert.strictEqual((await ok(anita, 'GET', '/api/dashboard')).overdue_count, 1);
    const portal = await ok(malabar, 'GET', '/api/dashboard');
    assert.strictEqual(portal.overdue_amount, 133468);
    assert.strictEqual((await call(rahul, 'GET', '/api/reports')).status, 403);
    const rep = await ok(meera, 'GET', '/api/reports');
    assert.strictEqual(rep.discount_usage.find(d => d.code === 'VOLUME10').total_discount, 31400);
    step('dashboard: MRR ₹23,550, outstanding ₹1,33,468, 1 overdue; reports gated');

    // Rejections, audit, user management.
    const rej = (await ok(rahul, 'POST', '/api/requests', { type: 'custom_price', submit: true, payload: { subscription_id: quote.id, price: 9000 } })).id;
    assert.strictEqual((await call(anita, 'POST', `/api/requests/${rej}/reject`, {})).status, 400);
    await ok(anita, 'POST', `/api/requests/${rej}/reject`, { comment: 'Too low' });
    assert.ok((await ok(rahul, 'GET', '/api/notifications')).some(n => /rejected: Too low/.test(n.message)));
    const users = await ok(anita, 'GET', '/api/users');
    const r = users.find(u => u.name === 'Rahul');
    await ok(anita, 'PUT', `/api/users/${r.id}/permissions`, { reports: 'view' });
    assert.strictEqual((await call(rahul, 'GET', '/api/reports')).status, 200);
    await ok(anita, 'PUT', `/api/users/${r.id}`, { active: 0 });
    assert.strictEqual((await call(rahul, 'GET', '/api/me')).status, 401);
    const audit = await ok(anita, 'GET', '/api/audit');
    for (const a of ['permission_changed', 'request_approved', 'invoice_created', 'payment_recorded', 'user_updated', 'subscription_paused']) assert.ok(audit.some(x => x.action === a), a);
    step('rejection with reason, permission override, deactivation, audit trail');

    // Flash sales: live deck for customers, discount applied at checkout, wrong product refused, gone after expiry.
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-02' });
    const studio = (await ok(null, 'POST', '/api/auth/signup', { company: 'Fort Kochi Films', name: 'Ria', email: 'ria@fkfilms.in', password: 'Films@123' })).token;
    const deck = await ok(studio, 'GET', '/api/flash-sales');
    assert.ok(deck.length >= 4, 'flash deck has cards');
    const r5 = deck.find(d => d.code === 'FLASHR5');
    assert.strictEqual(r5.sale_price, 2474.25);
    const otherPlan = (await ok(studio, 'GET', '/api/plans')).find(p => p.name === 'Audio Kit Monthly');
    assert.strictEqual((await call(studio, 'POST', '/api/portal/subscribe', { plan_id: otherPlan.id, quantity: 1, discount_code: 'FLASHR5' })).status, 400);
    const fs5 = await ok(studio, 'POST', '/api/portal/subscribe', { plan_id: r5.plan_id, quantity: 1, discount_code: 'FLASHR5' });
    await ok(anita, 'POST', `/api/subscriptions/${fs5.id}/confirm`); // Rahul was deactivated above
    const flashRun = await ok(meera, 'POST', '/api/billing/run');
    assert.strictEqual(flashRun.created.length, 1);
    const fInv = await ok(meera, 'GET', `/api/invoices/${flashRun.created[0].id}`);
    assert.strictEqual(fInv.taxable, 2474.25);
    assert.strictEqual(fInv.total, 2919.62);
    await ok(anita, 'PUT', '/api/settings/date', { date: '2026-11-08' });
    assert.ok(!(await ok(studio, 'GET', '/api/flash-sales')).some(d => d.code === 'FLASHR5'));
    step('flash sale: deck, FLASHR5 25% off at checkout (₹2,919.62 incl. GST), expires on time');

    await ok(anita, 'PUT', '/api/settings/date', { date: '2027-01-15' });
    console.log('\nAll scenario checks passed.');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

