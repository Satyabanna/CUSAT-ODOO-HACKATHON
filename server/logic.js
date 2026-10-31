// Business rules: access control, pricing, billing, scheduled jobs and request application.
const db = require('./db');

const TABS = ['dashboard', 'users', 'products', 'plans', 'taxes', 'discounts', 'templates',
  'subscriptions', 'invoices', 'payments', 'requests', 'reports'];
const LEVELS = ['none', 'view', 'edit', 'full'];
const PAYMENT_TERMS_DAYS = 30;

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new AppError(status, message); };

// ---------- dates ----------
// The business date can be moved by the admin so the month can be simulated offline.
function today() {
  const s = db.get("SELECT value FROM settings WHERE key = 'business_date'");
  return s && s.value ? s.value : new Date().toISOString().slice(0, 10);
}
function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function addPeriod(d, period, n = 1) {
  const t = new Date(d + 'T00:00:00Z');
  const day = t.getUTCDate();
  t.setUTCDate(1);
  t.setUTCMonth(t.getUTCMonth() + (period === 'year' ? 12 * n : n));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- access control ----------
function levelOf(user, tab) {
  const o = db.get('SELECT level FROM user_permissions WHERE user_id = ? AND tab = ?', [user.id, tab]);
  if (o) return o.level;
  const d = db.get('SELECT level FROM role_permissions WHERE role = ? AND tab = ?', [user.role, tab]);
  return d ? d.level : 'none';
}
function permissions(user) {
  return Object.fromEntries(TABS.map(t => [t, levelOf(user, t)]));
}
const atLeast = (have, need) => LEVELS.indexOf(have) >= LEVELS.indexOf(need);

// ---------- audit & notifications ----------
function audit(userId, action, entity, entityId, details) {
  db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
    [userId || null, action, entity || null, entityId || null, details ? JSON.stringify(details) : null]);
}
function notify(userId, kind, message) {
  db.run('INSERT INTO notifications (user_id, kind, message) VALUES (?,?,?)', [userId, kind, message]);
  const u = db.get('SELECT email FROM users WHERE id = ?', [userId]);
  console.log(`[notify:${kind}] -> ${u ? u.email : userId}: ${message}`);
}
function notifyCustomer(customerId, kind, message) {
  for (const u of db.all('SELECT id FROM users WHERE customer_id = ? AND active = 1', [customerId])) notify(u.id, kind, message);
}
function notifyTab(tab, need, kind, message) {
  for (const u of db.all("SELECT * FROM users WHERE active = 1 AND role != 'customer'")) {
    if (atLeast(levelOf(u, tab), need)) notify(u.id, kind, message);
  }
}

// ---------- pricing ----------
function discountUsable(d, qty, productId, onDate) {
  if (!d || !d.active) return { ok: false, why: 'inactive' };
  if (d.start_date && onDate < d.start_date) return { ok: false, why: 'not started' };
  if (d.end_date && onDate > d.end_date) return { ok: false, why: 'expired' };
  if (d.usage_limit != null && d.usage_count >= d.usage_limit) return { ok: false, why: 'usage limit reached' };
  if (qty < d.min_qty) return { ok: false, why: `minimum ${d.min_qty} not met` };
  if (d.product_id && d.product_id !== productId) return { ok: false, why: 'different product' };
  return { ok: true };
}
function discountStatus(d, onDate) {
  if (!d.active) return 'inactive';
  if (d.end_date && onDate > d.end_date) return 'expired';
  if (d.usage_limit != null && d.usage_count >= d.usage_limit) return 'used up';
  if (d.start_date && onDate < d.start_date) return 'scheduled';
  return 'live';
}

// Price one billing period of a subscription. The discount is applied before tax (GST).
function priceSubscription(sub, onDate, planOverride) {
  const plan = planOverride || db.get('SELECT * FROM plans WHERE id = ?', [sub.plan_id]);
  const product = db.get('SELECT * FROM products WHERE id = ?', [plan.product_id]);
  const variant = sub.variant_id ? db.get('SELECT * FROM variants WHERE id = ?', [sub.variant_id]) : null;
  const tax = product.tax_id ? db.get('SELECT * FROM taxes WHERE id = ?', [product.tax_id]) : null;
  const base = sub.custom_price != null ? sub.custom_price : plan.price;
  const unit = base + (variant ? variant.extra_price : 0);
  const subtotal = r2(unit * sub.quantity);
  const lines = [{
    description: `${plan.name} — ${sub.quantity} × (₹${base}${variant ? ` + ₹${variant.extra_price} ${variant.attribute}: ${variant.value}` : ''})${sub.custom_price != null ? ' [custom price]' : ''}`,
    amount: subtotal,
  }];
  let discount = null, discountAmount = 0;
  if (sub.discount_id) {
    const d = db.get('SELECT * FROM discounts WHERE id = ?', [sub.discount_id]);
    if (discountUsable(d, sub.quantity, plan.product_id, onDate).ok) {
      discount = d;
      discountAmount = r2(d.type === 'percent' ? subtotal * d.value / 100 : Math.min(d.value, subtotal));
      lines.push({ description: `${d.code} (${d.type === 'percent' ? d.value + '%' : '₹' + d.value}, minimum ${d.min_qty} met)`, amount: -discountAmount });
    }
  }
  const taxable = r2(subtotal - discountAmount);
  const taxRate = tax ? tax.rate : 0;
  const taxAmount = r2(taxable * taxRate / 100);
  return { plan, subtotal, discount, discountAmount, taxable, taxRate, taxName: tax ? tax.name : null, taxAmount, total: r2(taxable + taxAmount), lines };
}
function monthlyValue(sub, onDate) {
  const p = priceSubscription(sub, onDate);
  return r2(p.plan.period === 'year' ? p.taxable / 12 : p.taxable);
}

// ---------- invoices ----------
function invoiceBalance(inv) { return r2(inv.total - inv.amount_paid); }
function isOverdue(inv, onDate) {
  return ['confirmed', 'sent'].includes(inv.state) && invoiceBalance(inv) > 0 && inv.due_date < onDate;
}
function invoiceStatus(inv, onDate) { return isOverdue(inv, onDate) ? 'overdue' : inv.state; }

// Billing run: every active subscription whose next invoice date is today or earlier.
// The UNIQUE(subscription_id, period_start) constraint makes a second run on the same day a no-op.
function runBilling(userId) {
  const now = today();
  const created = [];
  db.tx(() => {
    const subs = db.all("SELECT * FROM subscriptions WHERE state = 'active' AND next_invoice_date IS NOT NULL AND next_invoice_date <= ?", [now]);
    for (let sub of subs) {
      let guard = 0;
      while (sub.next_invoice_date <= now && guard++ < 36) {
        if (sub.end_date && sub.next_invoice_date >= sub.end_date) break;
        // A plan change takes effect from the next billing period.
        if (sub.pending_plan_id) {
          db.run('UPDATE subscriptions SET plan_id = ?, pending_plan_id = NULL WHERE id = ?', [sub.pending_plan_id, sub.id]);
          audit(userId, 'plan_change_applied', 'subscription', sub.id, { plan_id: sub.pending_plan_id });
          sub = db.get('SELECT * FROM subscriptions WHERE id = ?', [sub.id]);
        }
        const periodStart = sub.next_invoice_date;
        if (db.get('SELECT id FROM invoices WHERE subscription_id = ? AND period_start = ?', [sub.id, periodStart])) {
          // Already billed: just make sure the schedule moved on.
        } else {
          const p = priceSubscription(sub, periodStart);
          const periodEnd = addDays(addPeriod(periodStart, p.plan.period), -1);
          const number = db.nextNumber('invoice', 'INV');
          const inv = db.run(`INSERT INTO invoices (number, subscription_id, customer_id, period_start, period_end, issue_date, due_date,
              subtotal, discount_id, discount_amount, taxable, tax_rate, tax_amount, total, state, created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
            [number, sub.id, sub.customer_id, periodStart, periodEnd, periodStart, addDays(periodStart, PAYMENT_TERMS_DAYS),
              p.subtotal, p.discount ? p.discount.id : null, p.discountAmount, p.taxable, p.taxRate, p.taxAmount, p.total, userId]);
          for (const l of p.lines) db.run('INSERT INTO invoice_lines (invoice_id, description, amount) VALUES (?,?,?)', [inv.id, l.description, l.amount]);
          if (p.taxAmount) db.run('INSERT INTO invoice_lines (invoice_id, description, amount) VALUES (?,?,?)', [inv.id, `${p.taxName} ${p.taxRate}%`, p.taxAmount]);
          if (p.discount) db.run('UPDATE discounts SET usage_count = usage_count + 1 WHERE id = ?', [p.discount.id]);
          audit(userId, 'invoice_created', 'invoice', inv.id, { number, total: p.total, subscription: sub.number });
          created.push({ id: inv.id, number, total: p.total, subscription: sub.number });
        }
        // Step from the start date so month-end anchors don't drift (31 Jan -> 28 Feb -> 31 Mar).
        const plan = db.get('SELECT period FROM plans WHERE id = ?', [sub.plan_id]);
        let k = 1, next = addPeriod(sub.start_date, plan.period, 1);
        while (next <= periodStart && k < 1200) next = addPeriod(sub.start_date, plan.period, ++k);
        db.run('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?', [next, sub.id]);
        sub = db.get('SELECT * FROM subscriptions WHERE id = ?', [sub.id]);
      }
    }
    audit(userId, 'billing_run', 'invoice', null, { date: now, created: created.length });
  });
  return created;
}

// ---------- scheduled jobs (run whenever the business date changes) ----------
let lastJobsDate = null;
function runJobs(force = false) {
  const now = today();
  if (!force && lastJobsDate === now) return;
  lastJobsDate = now;
  db.tx(() => {
    // Quotes that were not accepted in time expire automatically.
    for (const s of db.all("SELECT * FROM subscriptions WHERE state = 'quotation' AND quote_valid_until < ?", [now])) {
      db.run("UPDATE subscriptions SET state = 'expired' WHERE id = ?", [s.id]);
      audit(null, 'quote_expired', 'subscription', s.id, { number: s.number });
      if (s.salesperson_id) notify(s.salesperson_id, 'quote', `Quote ${s.number} expired without acceptance.`);
    }
    // Confirmed subscriptions become active on their start date.
    for (const s of db.all("SELECT * FROM subscriptions WHERE state = 'confirmed' AND start_date <= ?", [now])) {
      db.run("UPDATE subscriptions SET state = 'active', next_invoice_date = COALESCE(next_invoice_date, start_date) WHERE id = ?", [s.id]);
      audit(null, 'subscription_activated', 'subscription', s.id, { number: s.number });
    }
    // End of term: renewable plans get a new term; non-renewable auto-close plans close.
    for (const s of db.all("SELECT s.*, p.renewable, p.auto_close, p.period, p.term_periods FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.state = 'active' AND s.end_date IS NOT NULL AND s.end_date <= ?", [now])) {
      if (s.renewable) {
        const newEnd = addPeriod(s.end_date, s.period, s.term_periods || 1);
        db.run('UPDATE subscriptions SET end_date = ? WHERE id = ?', [newEnd, s.id]);
        audit(null, 'subscription_renewed', 'subscription', s.id, { from: s.end_date, to: newEnd });
        notifyCustomer(s.customer_id, 'renewal', `Subscription ${s.number} renewed until ${newEnd}.`);
      } else if (s.auto_close) {
        db.run("UPDATE subscriptions SET state = 'closed' WHERE id = ?", [s.id]);
        audit(null, 'subscription_closed', 'subscription', s.id, { reason: 'auto-close at end date' });
        notifyCustomer(s.customer_id, 'closed', `Subscription ${s.number} closed at its end date.`);
      }
    }
    // Overdue reminders, once per invoice.
    for (const inv of db.all("SELECT i.*, c.name AS customer FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.state IN ('confirmed','sent') AND i.overdue_notified = 0 AND i.due_date < ? AND i.total - i.amount_paid > 0.004", [now])) {
      db.run('UPDATE invoices SET overdue_notified = 1 WHERE id = ?', [inv.id]);
      audit(null, 'invoice_overdue', 'invoice', inv.id, { number: inv.number });
      const msg = `Invoice ${inv.number} (${inv.customer}) is overdue: ₹${invoiceBalance(inv)} due since ${inv.due_date}.`;
      notifyTab('invoices', 'edit', 'overdue', msg);
      notifyCustomer(inv.customer_id, 'overdue', `Reminder: ${msg}`);
    }
  });
}

// ---------- requests ----------
const REQUEST_TYPES = {
  discount: 'New discount',
  custom_price: 'Custom price for one customer',
  plan: 'New plan or plan change',
  product: 'New product or variant',
  sub_close: 'Close subscription early',
  sub_pause: 'Pause subscription',
  sub_resume: 'Resume subscription',
  sub_upgrade: 'Upgrade / change plan',
  refund: 'Refund or credit note',
};
const CUSTOMER_TYPES = ['sub_close', 'sub_pause', 'sub_resume', 'sub_upgrade'];

function validateRequest(user, type, p) {
  if (!REQUEST_TYPES[type]) fail(400, 'Unknown request type');
  if (user.role === 'customer' && !CUSTOMER_TYPES.includes(type)) fail(403, 'Customers can only request upgrades, pauses, resumes or cancellations');
  const needSub = () => {
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [p.subscription_id]);
    if (!s) fail(400, 'Subscription not found');
    if (user.role === 'customer' && s.customer_id !== user.customer_id) fail(403, 'Not your subscription');
    return s;
  };
  switch (type) {
    case 'discount':
      if (!p.code || !(p.value > 0)) fail(400, 'Discount code and a positive value are required');
      if (!['percent', 'fixed'].includes(p.type)) fail(400, 'Discount type must be percent or fixed');
      if (p.type === 'percent' && p.value > 100) fail(400, 'Percent cannot exceed 100');
      if (db.get('SELECT id FROM discounts WHERE code = ?', [p.code])) fail(400, 'That discount code already exists');
      break;
    case 'custom_price': needSub(); if (!(p.price >= 0)) fail(400, 'Price is required'); break;
    case 'plan': if (!p.name || !(p.price >= 0) || !p.product_id) fail(400, 'Plan name, product and price are required'); break;
    case 'product':
      if (p.product_id) { if (!p.attribute || !p.value) fail(400, 'Variant attribute and value are required'); }
      else if (!p.name) fail(400, 'Product name is required');
      break;
    case 'sub_pause': {
      const s = needSub(); const plan = db.get('SELECT * FROM plans WHERE id = ?', [s.plan_id]);
      if (!plan.pausable) fail(400, 'This plan cannot be paused');
      if (s.state !== 'active') fail(400, 'Only active subscriptions can be paused');
      break;
    }
    case 'sub_resume': { const s = needSub(); if (s.state !== 'paused') fail(400, 'Subscription is not paused'); break; }
    case 'sub_close': {
      const s = needSub(); const plan = db.get('SELECT * FROM plans WHERE id = ?', [s.plan_id]);
      if (!plan.closable) fail(400, 'This plan cannot be closed early');
      if (!['active', 'paused', 'confirmed', 'draft'].includes(s.state)) fail(400, 'Subscription cannot be closed in its current state');
      break;
    }
    case 'sub_upgrade': {
      const s = needSub(); const np = db.get('SELECT * FROM plans WHERE id = ? AND active = 1', [p.new_plan_id]);
      if (!np) fail(400, 'Choose an available plan');
      if (np.id === s.plan_id) fail(400, 'That is already the current plan');
      if (s.quantity < np.min_qty) fail(400, `${np.name} needs at least ${np.min_qty} seats`);
      break;
    }
    case 'refund': {
      const inv = db.get('SELECT * FROM invoices WHERE id = ?', [p.invoice_id]);
      if (!inv) fail(400, 'Invoice not found');
      if (!(p.amount > 0) || p.amount > inv.amount_paid + 0.004) fail(400, `Refund must be between 0 and the ₹${inv.amount_paid} paid`);
      break;
    }
  }
}

function canDecide(user, req) {
  const lvl = levelOf(user, 'requests');
  if (lvl === 'full') return true;
  // Staff may decide customers' self-service requests (e.g. pause), never pricing or policy.
  const raiser = db.get('SELECT role FROM users WHERE id = ?', [req.raised_by]);
  return lvl === 'edit' && raiser && raiser.role === 'customer' && CUSTOMER_TYPES.includes(req.type) && user.id !== req.raised_by;
}

// Approving a request creates the real record from the request details.
function applyRequest(req, user) {
  const p = JSON.parse(req.payload);
  const now = today();
  switch (req.type) {
    case 'discount': {
      const r = db.run('INSERT INTO discounts (code, type, value, min_qty, start_date, end_date, usage_limit, product_id) VALUES (?,?,?,?,?,?,?,?)',
        [p.code.toUpperCase(), p.type, p.value, p.min_qty || 1, p.start_date || null, p.end_date || null, p.usage_limit || null, p.product_id || null]);
      audit(user.id, 'discount_created', 'discount', r.id, { code: p.code, via_request: req.id });
      return `Discount ${p.code.toUpperCase()} created`;
    }
    case 'custom_price': {
      db.run('UPDATE subscriptions SET custom_price = ? WHERE id = ?', [p.price, p.subscription_id]);
      audit(user.id, 'custom_price_set', 'subscription', p.subscription_id, { price: p.price, via_request: req.id });
      return `Custom price ₹${p.price} set`;
    }
    case 'plan': {
      if (p.plan_id) {
        const id = newPlanVersion(p.plan_id, p, user.id);
        return `Plan version created (#${id})`;
      }
      const r = db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [p.name, p.product_id, p.price, p.period || 'month', p.min_qty || 1, p.term_periods || null,
        p.pausable ? 1 : 0, p.closable ? 1 : 0, p.renewable ? 1 : 0, p.auto_close ? 1 : 0]);
      audit(user.id, 'plan_created', 'plan', r.id, { name: p.name, via_request: req.id });
      return `Plan ${p.name} created`;
    }
    case 'product': {
      if (p.product_id) {
        const r = db.run('INSERT INTO variants (product_id, attribute, value, extra_price) VALUES (?,?,?,?)', [p.product_id, p.attribute, p.value, p.extra_price || 0]);
        audit(user.id, 'variant_created', 'variant', r.id, { via_request: req.id });
        return `Variant ${p.attribute}: ${p.value} created`;
      }
      const r = db.run('INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES (?,?,?,?,?)', [p.name, p.type || 'Service', p.sales_price || 0, p.cost_price || 0, p.tax_id || null]);
      audit(user.id, 'product_created', 'product', r.id, { via_request: req.id });
      return `Product ${p.name} created`;
    }
    case 'sub_pause': setSubState(p.subscription_id, 'paused', user.id, { via_request: req.id }); return 'Subscription paused';
    case 'sub_resume': setSubState(p.subscription_id, 'active', user.id, { via_request: req.id }); return 'Subscription resumed';
    case 'sub_close': setSubState(p.subscription_id, 'closed', user.id, { via_request: req.id }); return 'Subscription closed';
    case 'sub_upgrade': {
      db.run('UPDATE subscriptions SET pending_plan_id = ? WHERE id = ?', [p.new_plan_id, p.subscription_id]);
      audit(user.id, 'plan_change_scheduled', 'subscription', p.subscription_id, { plan_id: p.new_plan_id, via_request: req.id });
      return 'Plan change takes effect from the next billing period';
    }
    case 'refund': {
      const inv = db.get('SELECT * FROM invoices WHERE id = ?', [p.invoice_id]);
      if (p.amount > inv.amount_paid + 0.004) fail(400, 'Refund is larger than the amount paid');
      db.run('INSERT INTO payments (invoice_id, amount, method, date, note, recorded_by) VALUES (?,?,?,?,?,?)',
        [inv.id, -p.amount, 'refund', now, `Credit note via request #${req.id}${p.reason ? ': ' + p.reason : ''}`, user.id]);
      const paid = r2(inv.amount_paid - p.amount);
      db.run('UPDATE invoices SET amount_paid = ?, state = ? WHERE id = ?', [paid, inv.state === 'paid' && paid < inv.total ? 'sent' : inv.state, inv.id]);
      audit(user.id, 'refund_issued', 'invoice', inv.id, { amount: p.amount, via_request: req.id });
      return `Refund of ₹${p.amount} recorded`;
    }
  }
  fail(400, 'Unknown request type');
}

function setSubState(id, state, userId, details = {}) {
  const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [id]);
  if (!s) fail(404, 'Subscription not found');
  const extra = [];
  if (state === 'active' && s.state === 'paused' && s.next_invoice_date && s.next_invoice_date < today()) {
    extra.push(['next_invoice_date', today()]);
  }
  db.run(`UPDATE subscriptions SET state = ?${extra.map(e => `, ${e[0]} = ?`).join('')} WHERE id = ?`, [state, ...extra.map(e => e[1]), id]);
  audit(userId, 'subscription_' + state, 'subscription', id, { from: s.state, to: state, ...details });
  notifyCustomer(s.customer_id, 'subscription', `Subscription ${s.number} is now ${state}.`);
}

// Once a plan has active subscriptions its price is locked; a change creates a new version.
function newPlanVersion(planId, changes, userId) {
  const old = db.get('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!old) fail(404, 'Plan not found');
  const root = old.parent_plan_id || old.id;
  const maxV = db.get('SELECT MAX(version) AS v FROM plans WHERE id = ? OR parent_plan_id = ?', [root, root]).v;
  const f = { ...old, ...changes };
  const r = db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close, version, parent_plan_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [old.name, f.product_id, f.price, f.period, f.min_qty, f.term_periods || null,
    f.pausable ? 1 : 0, f.closable ? 1 : 0, f.renewable ? 1 : 0, f.auto_close ? 1 : 0, maxV + 1, root]);
  db.run('UPDATE plans SET active = 0 WHERE id = ?', [old.id]);
  audit(userId, 'plan_versioned', 'plan', r.id, { from_plan: old.id, version: maxV + 1, price: f.price });
  return r.id;
}
function planLocked(planId) {
  return !!db.get("SELECT id FROM subscriptions WHERE plan_id = ? AND state IN ('active','paused','confirmed') LIMIT 1", [planId]);
}

module.exports = {
  TABS, LEVELS, REQUEST_TYPES, CUSTOMER_TYPES, AppError, fail, today, addDays, addPeriod, daysBetween, r2,
  levelOf, permissions, atLeast, audit, notify, notifyCustomer, notifyTab,
  discountUsable, discountStatus, priceSubscription, monthlyValue,
  invoiceBalance, isOverdue, invoiceStatus, runBilling, runJobs,
  validateRequest, canDecide, applyRequest, setSubState, newPlanVersion, planLocked,
};
