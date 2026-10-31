// First-run data: the Brightloop case study as it stands at the end of Week 1.
const bcrypt = require('bcryptjs');
const db = require('./db');
const { TABS } = require('./logic');

const DEFAULTS = {
  admin: Object.fromEntries(TABS.map(t => [t, 'full'])),
  staff: {
    dashboard: 'view', users: 'none', products: 'view', plans: 'view', taxes: 'view', discounts: 'view',
    templates: 'view', subscriptions: 'edit', invoices: 'edit', payments: 'edit', requests: 'edit', reports: 'none',
  },
  customer: {
    dashboard: 'view', users: 'none', products: 'none', plans: 'view', taxes: 'none', discounts: 'none',
    templates: 'none', subscriptions: 'view', invoices: 'view', payments: 'view', requests: 'edit', reports: 'none',
  },
};

function seed() {
  db.tx(() => {
    db.run("INSERT INTO settings (key, value) VALUES ('business_date', '2026-10-31')");
    db.run("INSERT INTO counters (name, value) VALUES ('subscription', 40), ('invoice', 106)");
    for (const [role, tabs] of Object.entries(DEFAULTS)) {
      for (const [tab, level] of Object.entries(tabs)) db.run('INSERT INTO role_permissions (role, tab, level) VALUES (?,?,?)', [role, tab, level]);
    }
    const hash = p => bcrypt.hashSync(p, 10);
    const user = (name, email, pw, role, title, customerId) =>
      db.run('INSERT INTO users (name, email, password_hash, role, title, customer_id) VALUES (?,?,?,?,?,?)', [name, email, hash(pw), role, title, customerId || null]).id;

    user('Anita', 'anita@brightloop.in', 'Admin@123', 'admin', 'Admin');
    const rahul = user('Rahul', 'rahul@brightloop.in', 'Staff@123', 'staff', 'Sales');
    const meera = user('Meera', 'meera@brightloop.in', 'Staff@123', 'staff', 'Finance');
    // Example overrides from the case study: Meera gets full Payments, Rahul view only.
    db.run("INSERT INTO user_permissions (user_id, tab, level) VALUES (?, 'payments', 'full'), (?, 'reports', 'view'), (?, 'payments', 'view')", [meera, meera, rahul]);

    const malabar = db.run("INSERT INTO customers (name, email, phone, address) VALUES ('Malabar Logistics', 'accounts@malabarlogistics.in', '+91 484 400 1200', 'Willingdon Island, Kochi')").id;
    user('Malabar Logistics', 'accounts@malabarlogistics.in', 'Malabar@123', 'customer', null, malabar);

    const gst = db.run("INSERT INTO taxes (name, rate) VALUES ('GST', 18)").id;
    // Camera-as-a-service catalogue, priced so the case-study month still adds up.
    const product = (name, type, sales, cost) => db.run('INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES (?,?,?,?,?)', [name, type, sales, cost, gst]).id;
    const camera = product('Lumen X1 Mirrorless Camera', 'Camera', 12000, 4000);
    const kit = db.run("INSERT INTO variants (product_id, attribute, value, extra_price) VALUES (?, 'Lens kit', '24–70mm f/2.8', 560)", [camera]).id;
    db.run("INSERT INTO variants (product_id, attribute, value, extra_price) VALUES (?, 'Lens kit', '50mm f/1.8 prime', 320)", [camera]);
    const bundle = product('Creator Accessory Bundle', 'Accessory', 999, 380);
    product('Orbit G3 Gimbal', 'Accessory', 4500, 2100);
    product('ND Filter Set (4-stop, 6-stop, 10-stop)', 'Accessory', 1200, 450);
    db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close)
            VALUES ('Creator Kit Monthly', ?, 999, 'month', 1, NULL, 1, 1, 0, 0)`, [bundle]);
    const yearly = db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close)
            VALUES ('Pro Camera Yearly', ?, 12000, 'year', 5, 1, 0, 1, 1, 1)`, [camera]).id;
    db.run("INSERT INTO quote_templates (name, plan_id, variant_id, validity_days, default_qty) VALUES ('Studio Fleet Yearly', ?, ?, 15, 5)", [yearly, kit]);
    db.run("INSERT INTO audit_log (action, details) VALUES ('seeded', '\"Brightloop case study, week 1 catalogue\"')");
  });
}

// Rental catalogue v2: more gear, plans and flash sales. Idempotent, so it also upgrades existing databases.
function seedExtras() {
  if (db.get("SELECT value FROM settings WHERE key = 'catalogue_v2'")) return;
  db.tx(() => {
    const gst = (db.get("SELECT id FROM taxes WHERE name = 'GST'") || {}).id || db.run("INSERT INTO taxes (name, rate) VALUES ('GST', 18)").id;
    const product = (name, type, sales, cost) => (db.get('SELECT id FROM products WHERE name = ?', [name]) || {}).id
      || db.run('INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES (?,?,?,?,?)', [name, type, sales, cost, gst]).id;
    const variant = (pid, attribute, value, extra) => db.run('INSERT INTO variants (product_id, attribute, value, extra_price) VALUES (?,?,?,?)', [pid, attribute, value, extra]).id;
    const plan = (name, pid, price, period, minQty, { term = null, pausable = 1, closable = 1, renewable = 0, autoClose = 0 } = {}) =>
      (db.get('SELECT id FROM plans WHERE name = ?', [name]) || {}).id
      || db.run(`INSERT INTO plans (name, product_id, price, period, min_qty, term_periods, pausable, closable, renewable, auto_close)
          VALUES (?,?,?,?,?,?,?,?,?,?)`, [name, pid, price, period, minQty, term, pausable, closable, renewable, autoClose]).id;
    const flash = (code, pid, type, value, endDate, limit, headline) => {
      if (db.get('SELECT id FROM discounts WHERE code = ?', [code])) return;
      db.run(`INSERT INTO discounts (code, type, value, min_qty, start_date, end_date, usage_limit, product_id, flash, headline)
        VALUES (?,?,?,1,'2026-10-31',?,?,?,1,?)`, [code, type, value, endDate, limit, pid, headline]);
    };

    // Cameras
    const r5 = product('Lumen R5 Full-Frame Camera', 'Camera', 32000, 14500);
    variant(r5, 'Kit', 'Body only', 0); variant(r5, 'Kit', '24–105mm f/4 zoom', 1200);
    const cine = product('CinePocket 6K Cinema Camera', 'Camera', 18000, 8200);
    variant(cine, 'Media', '1TB SSD + cage', 600);
    const action = product('Hero 12 Action Camera', 'Camera', 3500, 1500);
    variant(action, 'Pack', 'Creator mod (mic + light)', 250);
    const drone = product('AeroLens Mini 4 Drone', 'Drone', 9000, 4100);
    variant(drone, 'Pack', 'Fly More (3 batteries)', 700);
    // Lenses
    const tele = product('70–200mm f/2.8 Telephoto Lens', 'Lens', 6500, 2900);
    const prime = product('35mm f/1.4 Prime Lens', 'Lens', 3800, 1600);
    // Accessories
    const light = product('Lumi 300 LED Light Kit', 'Lighting', 5200, 2300);
    variant(light, 'Kit', '2-light interview kit', 900);
    const mic = product('Wireless Mic Duo', 'Audio', 2400, 1000);
    const vmount = product('V-Mount Battery Pack', 'Power', 1600, 700);
    const tripod = product('Carbon Tripod Pro', 'Support', 1100, 450);
    const gimbal = product('Orbit G3 Gimbal', 'Support', 4500, 2100);
    const camera = (db.get("SELECT id FROM products WHERE name = 'Lumen X1 Mirrorless Camera'") || {}).id || product('Lumen X1 Mirrorless Camera', 'Camera', 12000, 4000);
    db.run("UPDATE products SET type = 'Support' WHERE id = ?", [gimbal]);

    // Rental plans
    plan('Lumen X1 Monthly', camera, 1199, 'month', 1);
    plan('Lumen R5 Monthly', r5, 3299, 'month', 1);
    plan('CinePocket Monthly', cine, 2499, 'month', 1);
    plan('Action Cam Monthly', action, 499, 'month', 1);
    plan('Drone Pilot Monthly', drone, 1899, 'month', 1);
    plan('Telephoto Lens Monthly', tele, 899, 'month', 1);
    plan('Prime Lens Monthly', prime, 549, 'month', 1);
    plan('Lighting Kit Monthly', light, 999, 'month', 1);
    plan('Audio Kit Monthly', mic, 399, 'month', 1);
    plan('Power Pack Monthly', vmount, 299, 'month', 2);
    plan('Gimbal Monthly', gimbal, 599, 'month', 1);
    plan('Tripod Monthly', tripod, 249, 'month', 1);
    const studio = plan('Production House Yearly', r5, 30000, 'year', 3, { term: 1, pausable: 0, renewable: 1, autoClose: 1 });
    const kit = (db.get("SELECT id FROM variants WHERE product_id = ? AND value LIKE '24–105%'", [r5]) || {}).id;
    if (!db.get("SELECT id FROM quote_templates WHERE name = 'Production House Yearly'")) {
      db.run("INSERT INTO quote_templates (name, plan_id, variant_id, validity_days, default_qty) VALUES ('Production House Yearly', ?, ?, 15, 3)", [studio, kit]);
    }

    // Flash sales (live during the case-study month)
    flash('FLASHR5', r5, 'percent', 25, '2026-11-07', 30, 'Full-frame week: shoot like the pros');
    flash('SKYHIGH', drone, 'percent', 30, '2026-11-05', 20, 'Take to the skies — 30% off drones');
    flash('LIGHTUP', light, 'percent', 20, '2026-11-15', 40, 'Light every interview');
    flash('ACTION150', action, 'fixed', 150, '2026-11-10', 50, 'Adventure ready: ₹150 off every month');
    flash('CINE15', cine, 'percent', 15, '2026-11-12', 25, 'Cinema look, rental price');

    db.run("INSERT INTO settings (key, value) VALUES ('catalogue_v2', '1')");
    db.run("INSERT INTO audit_log (action, details) VALUES ('catalogue_upgraded', '\"Rental catalogue v2: gear, plans and flash sales\"')");
  });
}

// Bundled product art for the seeded catalogue; only fills products that have no image yet.
const PRODUCT_ART = {
  'Lumen X1 Mirrorless Camera': 'lumen-x1', 'Lumen R5 Full-Frame Camera': 'lumen-r5', 'CinePocket 6K Cinema Camera': 'cinepocket',
  'Hero 12 Action Camera': 'hero12', 'AeroLens Mini 4 Drone': 'drone', '70–200mm f/2.8 Telephoto Lens': 'telephoto', '35mm f/1.4 Prime Lens': 'prime35',
  'Lumi 300 LED Light Kit': 'led-light', 'Wireless Mic Duo': 'mic-duo', 'V-Mount Battery Pack': 'vmount', 'Carbon Tripod Pro': 'tripod',
  'Orbit G3 Gimbal': 'gimbal', 'ND Filter Set (4-stop, 6-stop, 10-stop)': 'nd-filters', 'Creator Accessory Bundle': 'creator-bundle',
};
function seedProductArt() {
  for (const [name, file] of Object.entries(PRODUCT_ART)) {
    db.run("UPDATE products SET image = ? WHERE name = ? AND (image IS NULL OR image = '')", [`img/products/${file}.svg`, name]);
  }
}

module.exports = { seed, seedExtras, seedProductArt, DEFAULTS };
