// SQLite (via sql.js / WASM, so no native build is needed) with file persistence.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let db = null;
let dbFile = null;
let dirty = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
  title TEXT, customer_id INTEGER REFERENCES customers(id), active INTEGER NOT NULL DEFAULT 1,
  reset_token TEXT, reset_expires TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL, tab TEXT NOT NULL, level TEXT NOT NULL CHECK (level IN ('none','view','edit','full')),
  PRIMARY KEY (role, tab));
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id), tab TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('none','view','edit','full')), PRIMARY KEY (user_id, tab));
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  details TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, rate REAL NOT NULL CHECK (rate >= 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Service',
  sales_price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0,
  tax_id INTEGER REFERENCES taxes(id), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), attribute TEXT NOT NULL,
  value TEXT NOT NULL, extra_price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
  price REAL NOT NULL CHECK (price >= 0), period TEXT NOT NULL CHECK (period IN ('month','year')),
  min_qty INTEGER NOT NULL DEFAULT 1, term_periods INTEGER,
  pausable INTEGER NOT NULL DEFAULT 0, closable INTEGER NOT NULL DEFAULT 1,
  renewable INTEGER NOT NULL DEFAULT 0, auto_close INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1, parent_plan_id INTEGER REFERENCES plans(id),
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')), value REAL NOT NULL CHECK (value > 0),
  min_qty INTEGER NOT NULL DEFAULT 1, start_date TEXT, end_date TEXT,
  usage_limit INTEGER, usage_count INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS quote_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan_id INTEGER NOT NULL REFERENCES plans(id),
  variant_id INTEGER REFERENCES variants(id), validity_days INTEGER NOT NULL DEFAULT 15,
  default_qty INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id), variant_id INTEGER REFERENCES variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), discount_id INTEGER REFERENCES discounts(id),
  custom_price REAL, pending_plan_id INTEGER REFERENCES plans(id),
  state TEXT NOT NULL CHECK (state IN ('draft','quotation','confirmed','active','paused','closed','expired','cancelled')),
  start_date TEXT NOT NULL, end_date TEXT, next_invoice_date TEXT, quote_valid_until TEXT,
  salesperson_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id), period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  issue_date TEXT NOT NULL, due_date TEXT NOT NULL, subtotal REAL NOT NULL, discount_id INTEGER REFERENCES discounts(id),
  discount_amount REAL NOT NULL DEFAULT 0, taxable REAL NOT NULL, tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL, total REAL NOT NULL, amount_paid REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('draft','confirmed','sent','paid','cancelled')),
  overdue_notified INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id),
  UNIQUE (subscription_id, period_start));
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), description TEXT NOT NULL, amount REAL NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount REAL NOT NULL,
  method TEXT NOT NULL, date TEXT NOT NULL, note TEXT, recorded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','applied')),
  title TEXT, payload TEXT NOT NULL, raised_by INTEGER NOT NULL REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id), comment TEXT, result TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, decided_at TEXT);
`;

async function open(dir) {
  const SQL = await initSqlJs({ locateFile: f => path.join(path.dirname(require.resolve('sql.js')), f) });
  fs.mkdirSync(dir, { recursive: true });
  dbFile = path.join(dir, 'brightloop.db');
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate();
  return dbFile;
}

// Additive migrations for databases created by earlier versions.
function migrate() {
  const cols = all('PRAGMA table_info(discounts)').map(c => c.name);
  if (!cols.includes('flash')) db.run('ALTER TABLE discounts ADD COLUMN flash INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('headline')) db.run('ALTER TABLE discounts ADD COLUMN headline TEXT');
  const pcols = all('PRAGMA table_info(products)').map(c => c.name);
  // image: bundled art path ("img/products/x.svg") or an uploaded photo as a data URL.
  if (!pcols.includes('image')) db.run('ALTER TABLE products ADD COLUMN image TEXT');
  if (!pcols.includes('image_rev')) db.run('ALTER TABLE products ADD COLUMN image_rev INTEGER NOT NULL DEFAULT 0');
  dirty = true;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}
const get = (sql, params = []) => all(sql, params)[0];
function run(sql, params = []) {
  db.run(sql, params);
  dirty = true;
  return { id: get('SELECT last_insert_rowid() AS id').id, changes: db.getRowsModified() };
}

let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.run('BEGIN');
  try {
    const r = fn();
    db.run('COMMIT');
    return r;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  } finally { txDepth--; }
}

function save() {
  if (!dirty || !db) return;
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, dbFile);
  dirty = false;
}

function nextNumber(name, prefix) {
  run('UPDATE counters SET value = value + 1 WHERE name = ?', [name]);
  const v = get('SELECT value FROM counters WHERE name = ?', [name]).value;
  return `${prefix}/${String(v).padStart(4, '0')}`;
}

module.exports = { open, all, get, run, tx, save, nextNumber, isEmpty: () => !get('SELECT id FROM users LIMIT 1') };
