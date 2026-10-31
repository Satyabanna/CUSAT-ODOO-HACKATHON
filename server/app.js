// HTTP API. Every route checks the caller's tab permission on the server, not just the menu.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const L = require('./logic');
const { seed, seedExtras, seedProductArt } = require('./seed');

const { fail, audit, notify, today, r2 } = L;
const sessions = new Map();
const PASSWORD_RULE = 'at least 8 characters with an uppercase letter, a lowercase letter, a digit and a symbol';
const passwordOk = p => typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const num = v => (v === '' || v == null ? null : Number(v));
const bool = v => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

const h = fn => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    let status = e.status || 500, message = e.message;
    if (/UNIQUE constraint failed: invoices\.subscription_id/.test(message)) { status = 409; message = 'That billing period is already invoiced'; }
    else if (/UNIQUE constraint failed: users\.email/.test(message)) { status = 409; message = 'That email is already registered'; }
    else if (/UNIQUE constraint failed: discounts\.code/.test(message)) { status = 409; message = 'That discount code already exists'; }
    else if (/constraint failed/.test(message)) status = 400;
    if (status === 500) console.error(e);
    res.status(status).json({ error: message });
  }
};

function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.query.token;
  const s = token && sessions.get(token);
  const user = s && db.get('SELECT * FROM users WHERE id = ?', [s.userId]);
  if (!user || !user.active) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  req.token = token;
  try { L.runJobs(); } catch (e) { console.error(e); }
  next();
}
const perm = (tab, need = 'view') => (req, res, next) => {
  const have = L.levelOf(req.user, tab);
  if (!L.atLeast(have, need)) return res.status(403).json({ error: `You need ${need} access to ${tab} (you have ${have})` });
  req.level = have;
  next();
};
const isCustomer = req => req.user.role === 'customer';
const ownCustomer = (req, customerId) => { if (isCustomer(req) && customerId !== req.user.customer_id) fail(403, 'Not your record'); };

function publicUser(u) {
  const { password_hash, reset_token, reset_expires, ...rest } = u;
  return rest;
}

function subView(s, onDate) {
  const plan = db.get('SELECT * FROM plans WHERE id = ?', [s.plan_id]);
  const price = L.priceSubscription(s, onDate || today());
  return {
    ...s, plan_name: plan.name, plan_version: plan.version, period: plan.period,
    customer: db.get('SELECT name FROM customers WHERE id = ?', [s.customer_id]).name,
    variant: s.variant_id ? (v => `${v.attribute}: ${v.value}`)(db.get('SELECT * FROM variants WHERE id = ?', [s.variant_id])) : null,
    discount_code: s.discount_id ? db.get('SELECT code FROM discounts WHERE id = ?', [s.discount_id]).code : null,
    pending_plan: s.pending_plan_id ? db.get('SELECT name FROM plans WHERE id = ?', [s.pending_plan_id]).name : null,
    salesperson: s.salesperson_id ? (db.get('SELECT name FROM users WHERE id = ?', [s.salesperson_id]) || {}).name : null,
    pausable: plan.pausable, closable: plan.closable,
    recurring_total: price.total, recurring_taxable: price.taxable,
    mrr: L.r2(plan.period === 'year' ? price.taxable / 12 : price.taxable),
  };
}
function invView(i, onDate) {
  return {
    ...i, balance: L.invoiceBalance(i), status: L.invoiceStatus(i, onDate || today()),
    customer: db.get('SELECT name FROM customers WHERE id = ?', [i.customer_id]).name,
    subscription: db.get('SELECT number FROM subscriptions WHERE id = ?', [i.subscription_id]).number,
  };
}

function resolveDiscount(code, qty, productId, onDate) {
  if (!code) return null;
  const d = db.get('SELECT * FROM discounts WHERE code = ?', [String(code).trim()]);
  if (!d) fail(400, `Discount ${code} does not exist`);
  const u = L.discountUsable(d, qty, productId, onDate);
  if (!u.ok) fail(400, `Discount ${d.code} cannot be used: ${u.why}`);
  return d.id;
}

function createSubscription(req, { customer_id, plan_id, variant_id, quantity, start_date, discount_code, state, quote_valid_until }) {
  const plan = db.get('SELECT * FROM plans WHERE id = ?', [plan_id]);
  if (!plan || !plan.active) fail(400, 'Choose an available plan');
  if (!db.get('SELECT id FROM customers WHERE id = ?', [customer_id])) fail(400, 'Choose a customer');
  quantity = Number(quantity) || plan.min_qty;
  if (quantity < plan.min_qty) fail(400, `${plan.name} needs a minimum quantity of ${plan.min_qty}`);
  if (variant_id && !db.get('SELECT id FROM variants WHERE id = ? AND product_id = ?', [variant_id, plan.product_id])) fail(400, 'Variant does not belong to this plan\'s product');
  start_date = start_date || today();
  const discountId = resolveDiscount(discount_code, quantity, plan.product_id, start_date > today() ? start_date : today());
  const number = db.nextNumber('subscription', 'SUB');
  const endDate = plan.term_periods ? L.addPeriod(start_date, plan.period, plan.term_periods) : null;
  const r = db.run(`INSERT INTO subscriptions (number, customer_id, plan_id, variant_id, quantity, discount_id, state, start_date, end_date,
      quote_valid_until, salesperson_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  [number, customer_id, plan_id, variant_id || null, quantity, discountId, state, start_date, endDate, quote_valid_until || null,
    isCustomer(req) ? null : req.user.id]);
  audit(req.user.id, 'subscription_created', 'subscription', r.id, { number, state });
  return db.get('SELECT * FROM subscriptions WHERE id = ?', [r.id]);
}

function confirmSubscription(req, s) {
  if (!['draft', 'quotation'].includes(s.state)) fail(400, `A ${s.state} subscription cannot be confirmed`);
  if (s.state === 'quotation' && s.quote_valid_until < today()) fail(400, 'The quote has expired');
  db.run("UPDATE subscriptions SET state = 'confirmed', next_invoice_date = start_date WHERE id = ?", [s.id]);
  audit(req.user.id, 'subscription_confirmed', 'subscription', s.id, { from: s.state });
  L.notifyCustomer(s.customer_id, 'subscription', `Subscription ${s.number} is confirmed, starting ${s.start_date}.`);
  L.runJobs(true);
  return db.get('SELECT * FROM subscriptions WHERE id = ?', [s.id]);
}

function createApp({ dataDir }) {
  const app = express();
  app.use(express.json({ limit: '4mb' })); // product photo uploads arrive as data URLs
  app.use((req, res, next) => { res.on('finish', () => { try { db.save(); } catch (e) { console.error(e); } }); next(); });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Product images are catalogue marketing material, so they are served without a session (like the static files).
  const TYPE_ART = { Camera: 'lumen-x1', Lens: 'prime35', Drone: 'drone', Lighting: 'led-light', Audio: 'mic-duo', Power: 'vmount', Support: 'tripod', Accessory: 'creator-bundle' };
  app.get('/media/product/:id', (req, res) => {
    const p = db.get('SELECT type, image FROM products WHERE id = ?', [Number(req.params.id)]);
    if (!p) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=31536000'); // URLs carry ?v=<image_rev>
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(p.image || '');
    if (m) return res.type(m[1]).send(Buffer.from(m[2], 'base64'));
    const file = /^img\/products\/[a-z0-9-]+\.svg$/.test(p.image || '') ? p.image : `img/products/${TYPE_ART[p.type] || 'creator-bundle'}.svg`;
    res.sendFile(path.join(__dirname, '..', 'public', file));
  });

  // ---------- auth ----------
  app.post('/api/auth/login', h(req => {
    const { email, password } = req.body;
    const u = db.get('SELECT * FROM users WHERE email = ?', [String(email || '').trim()]);
    if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) fail(401, 'Wrong email or password');
    if (!u.active) fail(403, 'This account has been deactivated');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { userId: u.id });
    audit(u.id, 'login', 'user', u.id);
    return { token };
  }));
  app.post('/api/auth/signup', h(req => {
    const { company, name, email, password, phone, address } = req.body;
    if (!company || !name) fail(400, 'Company and contact name are required');
    if (!emailOk(email)) fail(400, 'Enter a valid email');
    if (db.get('SELECT id FROM users WHERE email = ?', [email.trim()])) fail(409, 'That email is already registered');
    if (!passwordOk(password)) fail(400, `Password must be ${PASSWORD_RULE}`);
    const id = db.tx(() => {
      const c = db.run('INSERT INTO customers (name, email, phone, address) VALUES (?,?,?,?)', [company, email.trim(), phone || null, address || null]).id;
      const u = db.run("INSERT INTO users (name, email, password_hash, role, customer_id) VALUES (?,?,?, 'customer', ?)", [name, email.trim(), bcrypt.hashSync(password, 10), c]).id;
      audit(u, 'signup', 'user', u, { company });
      L.notifyTab('subscriptions', 'edit', 'signup', `New portal customer: ${company} (${email}).`);
      return u;
    });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { userId: id });
    return { token };
  }));
  app.post('/api/auth/forgot', h(req => {
    const u = db.get('SELECT * FROM users WHERE email = ? AND active = 1', [String(req.body.email || '').trim()]);
    if (!u) return { message: 'If that email exists, a reset link has been sent.' };
    const token = crypto.randomBytes(16).toString('hex');
    db.run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, new Date(Date.now() + 3600e3).toISOString(), u.id]);
    notify(u.id, 'password_reset', `Password reset requested. Reset code: ${token}`);
    audit(u.id, 'password_reset_requested', 'user', u.id);
    // Offline build: email delivery is simulated, so the code is shown on screen and logged to the console.
    return { message: 'Reset code generated (email is simulated offline).', reset_code: token };
  }));
  app.post('/api/auth/reset', h(req => {
    const { code, password } = req.body;
    const u = db.get('SELECT * FROM users WHERE reset_token = ?', [String(code || '')]);
    if (!u || !u.reset_expires || u.reset_expires < new Date().toISOString()) fail(400, 'Invalid or expired reset code');
    if (!passwordOk(password)) fail(400, `Password must be ${PASSWORD_RULE}`);
    db.run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [bcrypt.hashSync(password, 10), u.id]);
    audit(u.id, 'password_reset', 'user', u.id);
    return { ok: true };
  }));

  app.use('/api', auth);

  app.post('/api/auth/logout', h(req => { sessions.delete(req.token); return { ok: true }; }));
  app.get('/api/me', h(req => ({
    user: publicUser(req.user), permissions: L.permissions(req.user), today: today(),
    customer: req.user.customer_id ? db.get('SELECT * FROM customers WHERE id = ?', [req.user.customer_id]) : null,
    unread: db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).n,
  })));
  app.post('/api/me/password', h(req => {
    const { current, password } = req.body;
    if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) fail(400, 'Current password is wrong');
    if (!passwordOk(password)) fail(400, `Password must be ${PASSWORD_RULE}`);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), req.user.id]);
    audit(req.user.id, 'password_changed', 'user', req.user.id);
    return { ok: true };
  }));
  app.get('/api/notifications', h(req => db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id])));
  app.post('/api/notifications/read', h(req => { db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]); return { ok: true }; }));

  // Business date (lets the admin simulate the month offline).
  app.put('/api/settings/date', perm('users', 'full'), h(req => {
    const d = req.body.date;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, 'Use YYYY-MM-DD');
    db.run("INSERT INTO settings (key, value) VALUES ('business_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [d || '']);
    audit(req.user.id, 'business_date_set', 'settings', null, { date: d || 'system clock' });
    L.runJobs(true);
    return { today: today() };
  }));

  // ---------- users & access ----------
  app.get('/api/users', perm('users'), h(() => db.all(`SELECT u.*, c.name AS company FROM users u LEFT JOIN customers c ON c.id = u.customer_id ORDER BY u.role, u.name`).map(publicUser)));
  app.post('/api/users', perm('users', 'full'), h(req => {
    const { name, email, password, role, title } = req.body;
    if (!name) fail(400, 'Name is required');
    if (!emailOk(email)) fail(400, 'Enter a valid email');
    if (!['admin', 'staff'].includes(role)) fail(400, 'Role must be admin or staff (customers sign up from the portal)');
    if (!passwordOk(password)) fail(400, `Password must be ${PASSWORD_RULE}`);
    const r = db.run('INSERT INTO users (name, email, password_hash, role, title) VALUES (?,?,?,?,?)', [name, email.trim(), bcrypt.hashSync(password, 10), role, title || null]);
    audit(req.user.id, 'user_created', 'user', r.id, { email, role });
    return { id: r.id };
  }));
  app.put('/api/users/:id', perm('users', 'full'), h(req => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) fail(404, 'User not found');
    const { name, title, role, active } = req.body;
    if (role && role !== u.role) {
      if (u.role === 'customer' || role === 'customer') fail(400, 'Customer accounts cannot change role');
      if (!['admin', 'staff'].includes(role)) fail(400, 'Invalid role');
    }
    if (u.id === req.user.id && (active === 0 || active === false || (role && role !== 'admin'))) fail(400, 'You cannot deactivate or demote yourself');
    const next = { name: name ?? u.name, title: title ?? u.title, role: role ?? u.role, active: active == null ? u.active : bool(active) };
    db.run('UPDATE users SET name = ?, title = ?, role = ?, active = ? WHERE id = ?', [next.name, next.title, next.role, next.active, u.id]);
    if (!next.active) for (const [t, s] of sessions) if (s.userId === u.id) sessions.delete(t);
    const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== u[k]).map(([k, v]) => [k, { from: u[k], to: v }]));
    audit(req.user.id, 'user_updated', 'user', u.id, changes);
    return { ok: true };
  }));
  app.post('/api/users/:id/reset-password', perm('users', 'full'), h(req => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) fail(404, 'User not found');
    if (!passwordOk(req.body.password)) fail(400, `Password must be ${PASSWORD_RULE}`);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(req.body.password, 10), u.id]);
    audit(req.user.id, 'password_reset_by_admin', 'user', u.id);
    notify(u.id, 'password_reset', 'Your password was reset by an administrator.');
    return { ok: true };
  }));
  app.get('/api/users/:id/permissions', perm('users'), h(req => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) fail(404, 'User not found');
    const overrides = Object.fromEntries(db.all('SELECT tab, level FROM user_permissions WHERE user_id = ?', [u.id]).map(r => [r.tab, r.level]));
    const defaults = Object.fromEntries(db.all('SELECT tab, level FROM role_permissions WHERE role = ?', [u.role]).map(r => [r.tab, r.level]));
    return { tabs: L.TABS, overrides, defaults, effective: L.permissions(u) };
  }));
  app.put('/api/users/:id/permissions', perm('users', 'full'), h(req => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) fail(404, 'User not found');
    db.tx(() => {
      for (const [tab, level] of Object.entries(req.body || {})) {
        if (!L.TABS.includes(tab)) fail(400, `Unknown tab ${tab}`);
        const before = (db.get('SELECT level FROM user_permissions WHERE user_id = ? AND tab = ?', [u.id, tab]) || {}).level || 'default';
        if (before === level) continue;
        if (level === 'default') db.run('DELETE FROM user_permissions WHERE user_id = ? AND tab = ?', [u.id, tab]);
        else {
          if (!L.LEVELS.includes(level)) fail(400, `Unknown level ${level}`);
          if (u.id === req.user.id && tab === 'users' && level !== 'full') fail(400, 'You cannot remove your own access to Users');
          db.run('INSERT INTO user_permissions (user_id, tab, level) VALUES (?,?,?) ON CONFLICT(user_id, tab) DO UPDATE SET level = excluded.level', [u.id, tab, level]);
        }
        audit(req.user.id, 'permission_changed', 'user', u.id, { tab, from: before, to: level });
      }
    });
    return { ok: true };
  }));
  app.get('/api/role-permissions', perm('users'), h(() => db.all('SELECT * FROM role_permissions')));
  app.put('/api/role-permissions', perm('users', 'full'), h(req => {
    const { role, tab, level } = req.body;
    if (!['admin', 'staff', 'customer'].includes(role) || !L.TABS.includes(tab) || !L.LEVELS.includes(level)) fail(400, 'Invalid role, tab or level');
    if (role === 'admin' && tab === 'users' && level !== 'full') fail(400, 'Admins must keep full access to Users');
    const before = (db.get('SELECT level FROM role_permissions WHERE role = ? AND tab = ?', [role, tab]) || {}).level;
    db.run('INSERT INTO role_permissions (role, tab, level) VALUES (?,?,?) ON CONFLICT(role, tab) DO UPDATE SET level = excluded.level', [role, tab, level]);
    audit(req.user.id, 'role_permission_changed', 'role', null, { role, tab, from: before, to: level });
    return { ok: true };
  }));
  app.get('/api/audit', perm('users'), h(req => db.all(`SELECT a.*, u.name AS user FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ?`, [Math.min(Number(req.query.limit) || 300, 2000)])));

  // ---------- customers ----------
  app.get('/api/customers', perm('subscriptions'), h(req => isCustomer(req)
    ? db.all('SELECT * FROM customers WHERE id = ?', [req.user.customer_id])
    : db.all('SELECT * FROM customers ORDER BY name')));
  app.post('/api/customers', perm('subscriptions', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const { name, email, phone, address } = req.body;
    if (!name) fail(400, 'Customer name is required');
    const r = db.run('INSERT INTO customers (name, email, phone, address) VALUES (?,?,?,?)', [name, email || null, phone || null, address || null]);
    audit(req.user.id, 'customer_created', 'customer', r.id, { name });
    return { id: r.id };
  }));

  // ---------- catalogue ----------
  app.get('/api/products', perm('products'), h(() => db.all('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id ORDER BY p.name')
    .map(({ image, ...p }) => ({ ...p, has_photo: /^data:/.test(image || ''), variants: db.all('SELECT * FROM variants WHERE product_id = ? ORDER BY id', [p.id]) }))));
  app.post('/api/products', perm('products', 'full'), h(req => {
    const { name, type, sales_price, cost_price, tax_id } = req.body;
    if (!name) fail(400, 'Product name is required');
    const r = db.run('INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES (?,?,?,?,?)', [name, type || 'Service', num(sales_price) || 0, num(cost_price) || 0, num(tax_id)]);
    audit(req.user.id, 'product_created', 'product', r.id, { name });
    return { id: r.id };
  }));
  app.put('/api/products/:id', perm('products', 'full'), h(req => {
    const p = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!p) fail(404, 'Product not found');
    const b = req.body;
    db.run('UPDATE products SET name = ?, type = ?, sales_price = ?, cost_price = ?, tax_id = ?, active = ? WHERE id = ?',
      [b.name ?? p.name, b.type ?? p.type, num(b.sales_price) ?? p.sales_price, num(b.cost_price) ?? p.cost_price, b.tax_id === undefined ? p.tax_id : num(b.tax_id), b.active == null ? p.active : bool(b.active), p.id]);
    audit(req.user.id, 'product_updated', 'product', p.id, b);
    return { ok: true };
  }));
  app.put('/api/products/:id/image', perm('products', 'full'), h(req => {
    const p = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!p) fail(404, 'Product not found');
    const data = req.body.data_url;
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
    if (!m) fail(400, 'Upload a PNG, JPEG or WebP image');
    if (m[2].length * 0.75 > 2.5 * 1024 * 1024) fail(400, 'Image is too large (max 2.5 MB after resizing)');
    db.run('UPDATE products SET image = ?, image_rev = image_rev + 1 WHERE id = ?', [data, p.id]);
    audit(req.user.id, 'product_image_uploaded', 'product', p.id, { format: m[1], kb: Math.round(m[2].length * 0.75 / 1024) });
    return { ok: true };
  }));
  app.delete('/api/products/:id/image', perm('products', 'full'), h(req => {
    const p = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!p) fail(404, 'Product not found');
    db.run('UPDATE products SET image = NULL, image_rev = image_rev + 1 WHERE id = ?', [p.id]);
    seedProductArt(); // seeded products fall back to their bundled art
    audit(req.user.id, 'product_image_removed', 'product', p.id);
    return { ok: true };
  }));
  app.post('/api/products/:id/variants', perm('products', 'full'), h(req => {
    const { attribute, value, extra_price } = req.body;
    if (!db.get('SELECT id FROM products WHERE id = ?', [req.params.id])) fail(404, 'Product not found');
    if (!attribute || !value) fail(400, 'Attribute and value are required');
    const r = db.run('INSERT INTO variants (product_id, attribute, value, extra_price) VALUES (?,?,?,?)', [req.params.id, attribute, value, num(extra_price) || 0]);
    audit(req.user.id, 'variant_created', 'variant', r.id, { attribute, value, extra_price });
    return { id: r.id };
  }));
  app.put('/api/variants/:id', perm('products', 'full'), h(req => {
    const v = db.get('SELECT * FROM variants WHERE id = ?', [req.params.id]);
    if (!v) fail(404, 'Variant not found');
    const b = req.body;
    db.run('UPDATE variants SET attribute = ?, value = ?, extra_price = ?, active = ? WHERE id = ?',
      [b.attribute ?? v.attribute, b.value ?? v.value, num(b.extra_price) ?? v.extra_price, b.active == null ? v.active : bool(b.active), v.id]);
    audit(req.user.id, 'variant_updated', 'variant', v.id, b);
    return { ok: true };
  }));
  app.get('/api/taxes', perm('taxes'), h(() => db.all('SELECT * FROM taxes ORDER BY name')));
  app.post('/api/taxes', perm('taxes', 'full'), h(req => {
    const { name, rate } = req.body;
    if (!name || !(Number(rate) >= 0)) fail(400, 'Tax name and rate are required');
    const r = db.run('INSERT INTO taxes (name, rate) VALUES (?,?)', [name, Number(rate)]);
    audit(req.user.id, 'tax_created', 'tax', r.id, { name, rate });
    return { id: r.id };
  }));
  app.put('/api/taxes/:id', perm('taxes', 'full'), h(req => {
    const t = db.get('SELECT * FROM taxes WHERE id = ?', [req.params.id]);
    if (!t) fail(404, 'Tax not found');
    const b = req.body;
    db.run('UPDATE taxes SET name = ?, rate = ?, active = ? WHERE id = ?', [b.name ?? t.name, num(b.rate) ?? t.rate, b.active == null ? t.active : bool(b.active), t.id]);
    audit(req.user.id, 'tax_updated', 'tax', t.id, b);
    return { ok: true };
  }));

  // ---------- plans ----------
  const planRow = p => ({ ...p, ...(pr => ({ product: pr.name, product_type: pr.type, image_rev: pr.image_rev }))(db.get('SELECT name, type, image_rev FROM products WHERE id = ?', [p.product_id])),
    variants: db.all('SELECT id, attribute, value, extra_price FROM variants WHERE product_id = ? AND active = 1', [p.product_id]), locked: L.planLocked(p.id),
    subscribers: db.get("SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ? AND state IN ('active','paused','confirmed')", [p.id]).n });
  app.get('/api/plans', perm('plans'), h(req => db.all(`SELECT * FROM plans ${isCustomer(req) ? 'WHERE active = 1' : ''} ORDER BY name, version`).map(planRow)));
  app.post('/api/plans', perm('plans', 'full'), h(req => {
    const b = req.body;
    if (!b.name || !b.product_id || !(Number(b.price) >= 0)) fail(400, 'Name, product and price are required');
    if (!['month', 'year'].includes(b.period)) fail(400, 'Period must be month or year');
    const r = db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [b.name, b.product_id, Number(b.price), b.period, Number(b.min_qty) || 1, num(b.term_periods),
      bool(b.pausable), bool(b.closable), bool(b.renewable), bool(b.auto_close)]);
    audit(req.user.id, 'plan_created', 'plan', r.id, { name: b.name });
    return { id: r.id };
  }));
  app.put('/api/plans/:id', perm('plans', 'full'), h(req => {
    const p = db.get('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    if (!p) fail(404, 'Plan not found');
    const b = req.body;
    const priceChange = (b.price != null && Number(b.price) !== p.price) || (b.period && b.period !== p.period);
    if (priceChange && L.planLocked(p.id)) {
      if (!b.new_version) fail(409, 'This plan has active subscriptions, so its price is locked. Save as a new version instead.');
      const id = L.newPlanVersion(p.id, { ...b, price: Number(b.price ?? p.price), min_qty: Number(b.min_qty ?? p.min_qty) }, req.user.id);
      return { id, versioned: true };
    }
    db.run(`UPDATE plans SET name = ?, price = ?, period = ?, min_qty = ?, term_periods = ?, pausable = ?, closable = ?, renewable = ?, auto_close = ?, active = ? WHERE id = ?`,
      [b.name ?? p.name, num(b.price) ?? p.price, b.period ?? p.period, num(b.min_qty) ?? p.min_qty, b.term_periods === undefined ? p.term_periods : num(b.term_periods),
        b.pausable == null ? p.pausable : bool(b.pausable), b.closable == null ? p.closable : bool(b.closable),
        b.renewable == null ? p.renewable : bool(b.renewable), b.auto_close == null ? p.auto_close : bool(b.auto_close),
        b.active == null ? p.active : bool(b.active), p.id]);
    audit(req.user.id, 'plan_updated', 'plan', p.id, b);
    return { id: p.id };
  }));

  // ---------- discounts ----------
  app.get('/api/discounts', perm('discounts'), h(() => db.all(`SELECT d.*, p.name AS product FROM discounts d LEFT JOIN products p ON p.id = d.product_id ORDER BY d.code`)
    .map(d => ({ ...d, status: L.discountStatus(d, today()) }))));
  const discountFields = b => {
    if (!b.code || !(Number(b.value) > 0)) fail(400, 'Code and a positive value are required');
    if (!['percent', 'fixed'].includes(b.type)) fail(400, 'Type must be percent or fixed');
    if (b.type === 'percent' && Number(b.value) > 100) fail(400, 'Percent cannot exceed 100');
    if (b.start_date && b.end_date && b.end_date < b.start_date) fail(400, 'End date is before start date');
    if (bool(b.flash) && !b.end_date) fail(400, 'A flash sale needs an end date');
    if (bool(b.flash) && !b.product_id) fail(400, 'A flash sale must apply to one product');
    return [String(b.code).toUpperCase().trim(), b.type, Number(b.value), Number(b.min_qty) || 1, b.start_date || null, b.end_date || null, num(b.usage_limit), num(b.product_id),
      bool(b.flash), b.headline || null];
  };
  app.post('/api/discounts', perm('discounts', 'full'), h(req => {
    const r = db.run('INSERT INTO discounts (code, type, value, min_qty, start_date, end_date, usage_limit, product_id, flash, headline) VALUES (?,?,?,?,?,?,?,?,?,?)', discountFields(req.body));
    audit(req.user.id, 'discount_created', 'discount', r.id, { code: req.body.code });
    return { id: r.id };
  }));
  app.put('/api/discounts/:id', perm('discounts', 'full'), h(req => {
    const d = db.get('SELECT * FROM discounts WHERE id = ?', [req.params.id]);
    if (!d) fail(404, 'Discount not found');
    const merged = { ...d, ...req.body };
    db.run('UPDATE discounts SET code = ?, type = ?, value = ?, min_qty = ?, start_date = ?, end_date = ?, usage_limit = ?, product_id = ?, flash = ?, headline = ?, active = ? WHERE id = ?',
      [...discountFields(merged), bool(merged.active), d.id]);
    audit(req.user.id, 'discount_updated', 'discount', d.id, req.body);
    return { ok: true };
  }));

  // Live flash sales for the card deck: any signed-in user (customers shop from them).
  app.get('/api/flash-sales', h(() => {
    const now = today();
    return db.all(`SELECT d.*, p.name AS product, p.type AS product_type, p.image_rev FROM discounts d JOIN products p ON p.id = d.product_id
        WHERE d.flash = 1 AND d.active = 1 ORDER BY d.end_date`)
      .filter(d => L.discountStatus(d, now) === 'live')
      .map(d => {
        const plans = db.all("SELECT * FROM plans WHERE product_id = ? AND active = 1 AND period = 'month' ORDER BY price", [d.product_id]);
        const plan = plans[0] || db.get('SELECT * FROM plans WHERE product_id = ? AND active = 1 ORDER BY price', [d.product_id]);
        if (!plan) return null;
        const sale = L.r2(d.type === 'percent' ? plan.price * (1 - d.value / 100) : Math.max(0, plan.price - d.value));
        return { id: d.id, code: d.code, type: d.type, value: d.value, headline: d.headline, end_date: d.end_date, product: d.product, product_type: d.product_type, image_rev: d.image_rev,
          product_id: d.product_id, plan_id: plan.id, plan_name: plan.name, period: plan.period, min_qty: plan.min_qty, price: plan.price, sale_price: sale,
          left: d.usage_limit != null ? d.usage_limit - d.usage_count : null };
      }).filter(Boolean);
  }));

  // ---------- quotation templates ----------
  app.get('/api/templates', perm('templates'), h(() => db.all(`SELECT t.*, p.name AS plan, p.active AS plan_active, v.attribute || ': ' || v.value AS variant
    FROM quote_templates t JOIN plans p ON p.id = t.plan_id LEFT JOIN variants v ON v.id = t.variant_id ORDER BY t.name`)));
  app.post('/api/templates', perm('templates', 'full'), h(req => {
    const b = req.body;
    if (!b.name || !b.plan_id) fail(400, 'Name and plan are required');
    const r = db.run('INSERT INTO quote_templates (name, plan_id, variant_id, validity_days, default_qty) VALUES (?,?,?,?,?)',
      [b.name, b.plan_id, num(b.variant_id), Number(b.validity_days) || 15, Number(b.default_qty) || 1]);
    audit(req.user.id, 'template_created', 'template', r.id, { name: b.name });
    return { id: r.id };
  }));
  app.put('/api/templates/:id', perm('templates', 'full'), h(req => {
    const t = db.get('SELECT * FROM quote_templates WHERE id = ?', [req.params.id]);
    if (!t) fail(404, 'Template not found');
    const b = req.body;
    db.run('UPDATE quote_templates SET name = ?, plan_id = ?, variant_id = ?, validity_days = ?, default_qty = ?, active = ? WHERE id = ?',
      [b.name ?? t.name, num(b.plan_id) ?? t.plan_id, b.variant_id === undefined ? t.variant_id : num(b.variant_id), num(b.validity_days) ?? t.validity_days,
        num(b.default_qty) ?? t.default_qty, b.active == null ? t.active : bool(b.active), t.id]);
    audit(req.user.id, 'template_updated', 'template', t.id, b);
    return { ok: true };
  }));
  app.post('/api/templates/:id/quote', perm('templates'), perm('subscriptions', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const t = db.get('SELECT * FROM quote_templates WHERE id = ? AND active = 1', [req.params.id]);
    if (!t) fail(404, 'Template not found');
    const s = db.tx(() => createSubscription(req, {
      customer_id: Number(req.body.customer_id), plan_id: t.plan_id, variant_id: t.variant_id,
      quantity: Number(req.body.quantity) || t.default_qty, start_date: req.body.start_date, discount_code: req.body.discount_code,
      state: 'quotation', quote_valid_until: L.addDays(today(), t.validity_days),
    }));
    L.notifyCustomer(s.customer_id, 'quote', `New quote ${s.number} is waiting for you, valid until ${s.quote_valid_until}.`);
    return subView(s);
  }));

  // ---------- subscriptions ----------
  app.get('/api/subscriptions', perm('subscriptions'), h(req => {
    const rows = isCustomer(req)
      ? db.all('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY id DESC', [req.user.customer_id])
      : db.all('SELECT * FROM subscriptions ORDER BY id DESC');
    return rows.map(s => subView(s));
  }));
  app.get('/api/subscriptions/:id', perm('subscriptions'), h(req => {
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!s) fail(404, 'Subscription not found');
    ownCustomer(req, s.customer_id);
    const preview = L.priceSubscription(s, today());
    const invoices = db.all(`SELECT * FROM invoices WHERE subscription_id = ? ${isCustomer(req) ? "AND state != 'draft'" : ''} ORDER BY id DESC`, [s.id]).map(i => invView(i));
    return { ...subView(s), preview: { lines: preview.lines, taxable: preview.taxable, tax: preview.taxAmount, total: preview.total }, invoices };
  }));
  app.post('/api/subscriptions', perm('subscriptions', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Customers subscribe from the Plans tab');
    const b = req.body;
    const quote = !!b.as_quote;
    const s = db.tx(() => createSubscription(req, { ...b, customer_id: Number(b.customer_id), plan_id: Number(b.plan_id), variant_id: num(b.variant_id),
      state: quote ? 'quotation' : 'draft', quote_valid_until: quote ? L.addDays(today(), Number(b.validity_days) || 15) : null }));
    if (quote) L.notifyCustomer(s.customer_id, 'quote', `New quote ${s.number} is waiting for you, valid until ${s.quote_valid_until}.`);
    return subView(s);
  }));
  app.post('/api/portal/subscribe', perm('plans'), h(req => {
    if (!isCustomer(req)) fail(403, 'Only portal customers subscribe themselves');
    const start = req.body.start_date;
    if (start && start < today()) fail(400, 'Start date cannot be in the past');
    const s = db.tx(() => createSubscription(req, { customer_id: req.user.customer_id, plan_id: Number(req.body.plan_id), quantity: req.body.quantity, start_date: start,
      variant_id: num(req.body.variant_id), discount_code: req.body.discount_code || null, state: 'draft' }));
    L.notifyTab('subscriptions', 'edit', 'subscription', `${subView(s).customer} signed up for ${subView(s).plan_name} (${s.number}); please confirm.`);
    return subView(s);
  }));
  app.put('/api/subscriptions/:id', perm('subscriptions', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!s) fail(404, 'Subscription not found');
    if (!['draft', 'quotation'].includes(s.state)) fail(400, 'Only draft subscriptions and quotes can be edited; raise a request for changes to live ones');
    const plan = db.get('SELECT * FROM plans WHERE id = ?', [s.plan_id]);
    const qty = Number(req.body.quantity ?? s.quantity);
    if (qty < plan.min_qty) fail(400, `${plan.name} needs a minimum quantity of ${plan.min_qty}`);
    const start = req.body.start_date || s.start_date;
    const discountId = req.body.discount_code !== undefined ? resolveDiscount(req.body.discount_code, qty, plan.product_id, start > today() ? start : today()) : s.discount_id;
    const variantId = req.body.variant_id !== undefined ? num(req.body.variant_id) : s.variant_id;
    db.run('UPDATE subscriptions SET quantity = ?, start_date = ?, end_date = ?, discount_id = ?, variant_id = ? WHERE id = ?',
      [qty, start, plan.term_periods ? L.addPeriod(start, plan.period, plan.term_periods) : null, discountId, variantId, s.id]);
    audit(req.user.id, 'subscription_updated', 'subscription', s.id, req.body);
    return subView(db.get('SELECT * FROM subscriptions WHERE id = ?', [s.id]));
  }));
  app.post('/api/subscriptions/:id/confirm', perm('subscriptions', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Customers accept quotes with Accept');
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!s) fail(404, 'Subscription not found');
    return subView(confirmSubscription(req, s));
  }));
  app.post('/api/subscriptions/:id/accept', perm('subscriptions'), h(req => {
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!s) fail(404, 'Subscription not found');
    ownCustomer(req, s.customer_id);
    if (!isCustomer(req) && !L.atLeast(req.level, 'edit')) fail(403, 'You need edit access to subscriptions');
    if (s.state !== 'quotation') fail(400, 'Only quotes can be accepted');
    const out = confirmSubscription(req, s);
    if (s.salesperson_id) notify(s.salesperson_id, 'quote', `Quote ${s.number} was accepted.`);
    return subView(out);
  }));
  app.post('/api/subscriptions/:id/state', perm('subscriptions', 'full'), h(req => {
    const s = db.get('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!s) fail(404, 'Subscription not found');
    const plan = db.get('SELECT * FROM plans WHERE id = ?', [s.plan_id]);
    const to = req.body.state;
    const allowed = { paused: ['active'], active: ['paused'], closed: ['active', 'paused', 'confirmed'], cancelled: ['draft', 'quotation'] };
    if (!allowed[to] || !allowed[to].includes(s.state)) fail(400, `Cannot move a ${s.state} subscription to ${to}`);
    if (to === 'paused' && !plan.pausable) fail(400, 'This plan is not pausable');
    if (to === 'closed' && !plan.closable) fail(400, 'This plan cannot be closed early');
    L.setSubState(s.id, to, req.user.id);
    return { ok: true };
  }));

  // ---------- invoices & billing ----------
  app.post('/api/billing/run', perm('invoices', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const created = L.runBilling(req.user.id);
    return { date: today(), created };
  }));
  app.get('/api/invoices', perm('invoices'), h(req => {
    const rows = isCustomer(req)
      ? db.all("SELECT * FROM invoices WHERE customer_id = ? AND state != 'draft' ORDER BY id DESC", [req.user.customer_id])
      : db.all('SELECT * FROM invoices ORDER BY id DESC');
    return rows.map(i => invView(i));
  }));
  const loadInvoice = req => {
    const i = db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!i) fail(404, 'Invoice not found');
    ownCustomer(req, i.customer_id);
    if (isCustomer(req) && i.state === 'draft') fail(404, 'Invoice not found');
    return i;
  };
  app.get('/api/invoices/:id', perm('invoices'), h(req => {
    const i = loadInvoice(req);
    return { ...invView(i), lines: db.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [i.id]),
      payments: db.all('SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE invoice_id = ? ORDER BY p.id', [i.id]) };
  }));
  const invoiceAction = (from, to, action) => h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const i = loadInvoice(req);
    if (!from.includes(i.state)) fail(400, `A ${i.state} invoice cannot be ${action}`);
    db.tx(() => {
      db.run('UPDATE invoices SET state = ? WHERE id = ?', [to, i.id]);
      if (to === 'cancelled' && i.discount_id) db.run('UPDATE discounts SET usage_count = MAX(usage_count - 1, 0) WHERE id = ?', [i.discount_id]);
      audit(req.user.id, 'invoice_' + action, 'invoice', i.id, { number: i.number, from: i.state, to });
      if (to === 'sent') L.notifyCustomer(i.customer_id, 'invoice', `Invoice ${i.number} for ₹${i.total} has been sent; due ${i.due_date}.`);
    });
    return invView(db.get('SELECT * FROM invoices WHERE id = ?', [i.id]));
  });
  app.post('/api/invoices/:id/confirm', perm('invoices', 'edit'), invoiceAction(['draft'], 'confirmed', 'confirmed'));
  app.post('/api/invoices/:id/send', perm('invoices', 'edit'), invoiceAction(['confirmed'], 'sent', 'sent'));
  app.post('/api/invoices/:id/cancel', perm('invoices', 'full'), (req, res, next) => {
    const i = db.get('SELECT amount_paid FROM invoices WHERE id = ?', [req.params.id]);
    if (i && i.amount_paid > 0) return res.status(400).json({ error: 'This invoice has payments; refund them through a request first' });
    next();
  }, invoiceAction(['draft', 'confirmed', 'sent'], 'cancelled', 'cancelled'));
  app.get('/api/invoices/:id/print', perm('invoices'), h((req, res) => {
    const i = loadInvoice(req);
    res.type('html').send(require('./print').invoiceHtml(invView(i), db.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [i.id]),
      db.get('SELECT * FROM customers WHERE id = ?', [i.customer_id]), db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id', [i.id])));
  }));

  // ---------- payments ----------
  app.get('/api/payments', perm('payments'), h(req => db.all(`SELECT p.*, i.number AS invoice, c.name AS customer, u.name AS recorded_by_name
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = p.recorded_by
    ${isCustomer(req) ? 'WHERE i.customer_id = ?' : ''} ORDER BY p.date DESC, p.id DESC`, isCustomer(req) ? [req.user.customer_id] : [])));
  app.post('/api/payments', perm('payments', 'edit'), h(req => {
    if (isCustomer(req)) fail(403, 'Not allowed');
    const { invoice_id, method, note } = req.body;
    const amount = r2(Number(req.body.amount));
    const date = req.body.date || today();
    const i = db.get('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (!i) fail(404, 'Invoice not found');
    if (i.state === 'cancelled') fail(400, 'Payments cannot be recorded against a cancelled invoice');
    if (i.state === 'draft') fail(400, 'Confirm the invoice before recording payments');
    if (!(amount > 0)) fail(400, 'Amount must be positive');
    const balance = L.invoiceBalance(i);
    if (amount > balance + 0.004) fail(400, `Payment of ₹${amount} is larger than the ₹${balance} still owed`);
    if (!method) fail(400, 'Payment method is required');
    const id = db.tx(() => {
      const r = db.run('INSERT INTO payments (invoice_id, amount, method, date, note, recorded_by) VALUES (?,?,?,?,?,?)', [i.id, amount, method, date, note || null, req.user.id]);
      const paid = r2(i.amount_paid + amount);
      const state = paid >= i.total - 0.004 ? 'paid' : i.state;
      db.run('UPDATE invoices SET amount_paid = ?, state = ? WHERE id = ?', [paid, state, i.id]);
      audit(req.user.id, 'payment_recorded', 'invoice', i.id, { number: i.number, amount, method, state });
      L.notifyCustomer(i.customer_id, 'payment', `Payment of ₹${amount} received for ${i.number}.${state === 'paid' ? ' Invoice is fully paid.' : ` ₹${r2(i.total - paid)} still due.`}`);
      return r.id;
    });
    return { id };
  }));

  // ---------- requests ----------
  const refs = p => ({
    subscription: p.subscription_id ? (db.get('SELECT number FROM subscriptions WHERE id = ?', [p.subscription_id]) || {}).number : undefined,
    invoice: p.invoice_id ? (db.get('SELECT number FROM invoices WHERE id = ?', [p.invoice_id]) || {}).number : undefined,
    plan: p.new_plan_id || p.plan_id ? (db.get("SELECT name || ' v' || version AS n FROM plans WHERE id = ?", [p.new_plan_id || p.plan_id]) || {}).n : undefined,
    product: p.product_id ? (db.get('SELECT name FROM products WHERE id = ?', [p.product_id]) || {}).name : undefined,
  });
  const reqView = r => ({ ...r, payload: JSON.parse(r.payload), refs: refs(JSON.parse(r.payload)), type_label: L.REQUEST_TYPES[r.type],
    raised_by_name: (db.get('SELECT name FROM users WHERE id = ?', [r.raised_by]) || {}).name,
    raised_by_role: (db.get('SELECT role FROM users WHERE id = ?', [r.raised_by]) || {}).role,
    decided_by_name: r.decided_by ? (db.get('SELECT name FROM users WHERE id = ?', [r.decided_by]) || {}).name : null });
  app.get('/api/requests/types', perm('requests'), h(req => Object.entries(L.REQUEST_TYPES)
    .filter(([k]) => !isCustomer(req) || L.CUSTOMER_TYPES.includes(k)).map(([value, label]) => ({ value, label }))));
  app.get('/api/requests', perm('requests'), h(req => {
    let rows;
    if (req.level === 'full') rows = db.all('SELECT * FROM requests ORDER BY id DESC');
    else if (isCustomer(req)) rows = db.all('SELECT * FROM requests WHERE raised_by = ? ORDER BY id DESC', [req.user.id]);
    else rows = db.all(`SELECT r.* FROM requests r JOIN users u ON u.id = r.raised_by WHERE r.raised_by = ? OR u.role = 'customer' ORDER BY r.id DESC`, [req.user.id]);
    return rows.map(r => ({ ...reqView(r), can_decide: r.status === 'submitted' && L.canDecide(req.user, r) }));
  }));
  app.post('/api/requests', perm('requests', 'edit'), h(req => {
    const { type, payload = {}, submit, title } = req.body;
    L.validateRequest(req.user, type, payload);
    const r = db.run('INSERT INTO requests (type, status, title, payload, raised_by) VALUES (?,?,?,?,?)',
      [type, submit ? 'submitted' : 'draft', title || L.REQUEST_TYPES[type], JSON.stringify(payload), req.user.id]);
    audit(req.user.id, submit ? 'request_submitted' : 'request_drafted', 'request', r.id, { type });
    if (submit) notifyDeciders(type, req.user, `New request #${r.id}: ${title || L.REQUEST_TYPES[type]} from ${req.user.name}.`);
    return { id: r.id };
  }));
  function notifyDeciders(type, raiser, msg) {
    L.notifyTab('requests', raiser.role === 'customer' && L.CUSTOMER_TYPES.includes(type) ? 'edit' : 'full', 'request', msg);
  }
  const loadRequest = req => {
    const r = db.get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!r) fail(404, 'Request not found');
    return r;
  };
  app.post('/api/requests/:id/submit', perm('requests', 'edit'), h(req => {
    const r = loadRequest(req);
    if (r.raised_by !== req.user.id) fail(403, 'Only the person who raised it can submit it');
    if (!['draft', 'rejected'].includes(r.status)) fail(400, `A ${r.status} request cannot be submitted`);
    L.validateRequest(req.user, r.type, JSON.parse(r.payload));
    db.run("UPDATE requests SET status = 'submitted', decided_by = NULL, decided_at = NULL WHERE id = ?", [r.id]);
    audit(req.user.id, 'request_submitted', 'request', r.id);
    notifyDeciders(r.type, req.user, `Request #${r.id} submitted by ${req.user.name}.`);
    return { ok: true };
  }));
  app.post('/api/requests/:id/approve', perm('requests', 'edit'), h(req => {
    const r = loadRequest(req);
    if (r.status !== 'submitted') fail(400, `A ${r.status} request cannot be approved`);
    if (!L.canDecide(req.user, r)) fail(403, 'Only the admin can approve this type of request');
    const result = db.tx(() => {
      db.run("UPDATE requests SET status = 'approved', decided_by = ?, comment = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?", [req.user.id, req.body.comment || null, r.id]);
      audit(req.user.id, 'request_approved', 'request', r.id, { comment: req.body.comment });
      const raiser = db.get('SELECT * FROM users WHERE id = ?', [r.raised_by]);
      L.validateRequest(raiser, r.type, JSON.parse(r.payload));
      const out = L.applyRequest(r, req.user);
      db.run("UPDATE requests SET status = 'applied', result = ? WHERE id = ?", [out, r.id]);
      audit(req.user.id, 'request_applied', 'request', r.id, { result: out });
      notify(r.raised_by, 'request', `Your request #${r.id} (${r.title}) was approved: ${out}.`);
      return out;
    });
    return { ok: true, result };
  }));
  app.post('/api/requests/:id/reject', perm('requests', 'edit'), h(req => {
    const r = loadRequest(req);
    if (r.status !== 'submitted') fail(400, `A ${r.status} request cannot be rejected`);
    if (!L.canDecide(req.user, r)) fail(403, 'Only the admin can reject this type of request');
    if (!req.body.comment) fail(400, 'A rejection needs a reason');
    db.run("UPDATE requests SET status = 'rejected', decided_by = ?, comment = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?", [req.user.id, req.body.comment, r.id]);
    audit(req.user.id, 'request_rejected', 'request', r.id, { comment: req.body.comment });
    notify(r.raised_by, 'request', `Your request #${r.id} (${r.title}) was rejected: ${req.body.comment}`);
    return { ok: true };
  }));

  // ---------- dashboard & reports ----------
  app.get('/api/dashboard', perm('dashboard'), h(req => require('./reports').dashboard(req, isCustomer(req))));
  app.get('/api/reports', perm('reports'), h(req => require('./reports').reports(req)));
  app.get('/api/lookups', h(req => (isCustomer(req) ? {} : {
    customers: db.all('SELECT id, name FROM customers ORDER BY name'),
    plans: db.all('SELECT id, name, version, active, product_id, min_qty FROM plans ORDER BY name, version'),
    staff: db.all("SELECT id, name FROM users WHERE role != 'customer' ORDER BY name"),
    variants: db.all('SELECT id, product_id, attribute, value, extra_price FROM variants WHERE active = 1'),
    products: db.all('SELECT id, name FROM products WHERE active = 1 ORDER BY name'),
    taxes: db.all('SELECT id, name, rate FROM taxes WHERE active = 1'),
    invoices: db.all("SELECT id, number, total, amount_paid FROM invoices WHERE state != 'cancelled' ORDER BY id DESC"),
  })));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

async function start({ dataDir, port = 0 }) {
  const file = await db.open(dataDir);
  if (db.isEmpty()) { seed(); console.log('Seeded new database at', file); }
  seedExtras();
  seedProductArt();
  db.save();
  L.runJobs(true);
  db.save();
  const app = createApp({ dataDir });
  return new Promise(resolve => {
    const server = app.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, file }));
  });
}

module.exports = { start };
