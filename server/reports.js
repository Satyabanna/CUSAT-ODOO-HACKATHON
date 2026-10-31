// Finance dashboard, customer summary and reports.
const db = require('./db');
const L = require('./logic');

const monthStart = d => d.slice(0, 8) + '01';

function customerSummary(req) {
  const now = L.today();
  const cid = req.user.customer_id;
  const subs = db.all('SELECT * FROM subscriptions WHERE customer_id = ?', [cid]);
  const invoices = db.all("SELECT * FROM invoices WHERE customer_id = ? AND state != 'draft'", [cid]);
  const open = invoices.filter(i => ['confirmed', 'sent'].includes(i.state));
  const overdue = open.filter(i => L.isOverdue(i, now));
  return {
    customer: true, today: now,
    active_subscriptions: subs.filter(s => s.state === 'active').length,
    quotes_waiting: subs.filter(s => s.state === 'quotation').length,
    outstanding: L.r2(open.reduce((a, i) => a + L.invoiceBalance(i), 0)),
    overdue_amount: L.r2(overdue.reduce((a, i) => a + L.invoiceBalance(i), 0)),
    overdue_invoices: overdue.map(i => ({ id: i.id, number: i.number, due_date: i.due_date, balance: L.invoiceBalance(i) })),
    next_invoice: subs.filter(s => s.state === 'active' && s.next_invoice_date).map(s => s.next_invoice_date).sort()[0] || null,
    recent_payments: db.all('SELECT p.*, i.number AS invoice FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = ? ORDER BY p.date DESC, p.id DESC LIMIT 10', [cid]),
  };
}

function dashboard(req, isCustomer) {
  if (isCustomer) return customerSummary(req);
  const now = L.today();
  const q = req.query;
  const from = q.from || monthStart(now), to = q.to || now;
  const where = [], args = [];
  if (q.plan_id) { where.push('s.plan_id = ?'); args.push(Number(q.plan_id)); }
  if (q.customer_id) { where.push('s.customer_id = ?'); args.push(Number(q.customer_id)); }
  if (q.staff_id) { where.push('s.salesperson_id = ?'); args.push(Number(q.staff_id)); }
  const subsAll = db.all(`SELECT s.* FROM subscriptions s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args);
  const subs = q.status ? subsAll.filter(s => s.state === q.status) : subsAll;
  const subIds = new Set(subsAll.map(s => s.id));
  const active = subs.filter(s => s.state === 'active');
  const invoices = db.all("SELECT * FROM invoices WHERE state != 'cancelled'").filter(i => subIds.has(i.subscription_id));
  const open = invoices.filter(i => ['confirmed', 'sent'].includes(i.state) && L.invoiceBalance(i) > 0);
  const overdue = open.filter(i => L.isOverdue(i, now));
  const invIds = new Set(invoices.map(i => i.id));
  const payments = db.all('SELECT * FROM payments WHERE date >= ? AND date <= ?', [from, to]).filter(p => invIds.has(p.invoice_id));
  const custName = id => db.get('SELECT name FROM customers WHERE id = ?', [id]).name;
  return {
    today: now, from, to,
    active_subscriptions: active.length,
    mrr: L.r2(active.reduce((a, s) => a + L.monthlyValue(s, now), 0)),
    revenue_collected: L.r2(payments.reduce((a, p) => a + p.amount, 0)),
    invoiced_in_range: L.r2(invoices.filter(i => i.issue_date >= from && i.issue_date <= to).reduce((a, i) => a + i.total, 0)),
    outstanding: L.r2(open.reduce((a, i) => a + L.invoiceBalance(i), 0)),
    overdue_count: overdue.length,
    pending_requests: db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'submitted'").n,
    by_state: subs.reduce((m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m), {}),
    to_chase: overdue.map(i => ({ id: i.id, number: i.number, customer: custName(i.customer_id), due_date: i.due_date,
      days_overdue: L.daysBetween(i.due_date, now), balance: L.invoiceBalance(i) })),
    subscriptions: subs.slice(0, 50).map(s => ({ id: s.id, number: s.number, customer: custName(s.customer_id),
      plan: db.get('SELECT name FROM plans WHERE id = ?', [s.plan_id]).name, state: s.state, next_invoice_date: s.next_invoice_date,
      mrr: s.state === 'active' ? L.monthlyValue(s, now) : 0 })),
  };
}

function reports(req) {
  const now = L.today();
  const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31';
  const byPlan = db.all(`SELECT p.name || ' v' || p.version AS plan, COUNT(i.id) AS invoices, COALESCE(SUM(i.taxable),0) AS taxable,
      COALESCE(SUM(i.tax_amount),0) AS tax, COALESCE(SUM(i.total),0) AS invoiced, COALESCE(SUM(i.amount_paid),0) AS collected
    FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id
    LEFT JOIN invoices i ON i.subscription_id = s.id AND i.state != 'cancelled' AND i.issue_date >= ? AND i.issue_date <= ?
    GROUP BY p.id ORDER BY invoiced DESC`, [from, to]).map(r => ({ ...r, outstanding: L.r2(r.invoiced - r.collected) }));
  const discountUsage = db.all(`SELECT d.code, d.type, d.value, d.usage_count, d.usage_limit, d.end_date, d.min_qty,
      COALESCE((SELECT SUM(discount_amount) FROM invoices i WHERE i.discount_id = d.id AND i.state != 'cancelled'), 0) AS total_discount
    FROM discounts d ORDER BY d.code`).map(d => ({ ...d, status: L.discountStatus({ ...d, active: 1 }, now) }));
  const buckets = { '0–30': { count: 0, amount: 0 }, '31–60': { count: 0, amount: 0 }, '60+': { count: 0, amount: 0 } };
  const unpaid = db.all("SELECT i.*, c.name AS customer FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.state IN ('confirmed','sent') AND i.total - i.amount_paid > 0.004")
    .map(i => {
      const age = Math.max(0, L.daysBetween(i.issue_date, now));
      const b = age <= 30 ? '0–30' : age <= 60 ? '31–60' : '60+';
      buckets[b].count++;
      buckets[b].amount = L.r2(buckets[b].amount + L.invoiceBalance(i));
      return { id: i.id, number: i.number, customer: i.customer, issue_date: i.issue_date, due_date: i.due_date, age, bucket: b, balance: L.invoiceBalance(i), overdue: L.isOverdue(i, now) };
    });
  return { today: now, revenue_by_plan: byPlan, discount_usage: discountUsage, ageing: buckets, unpaid };
}

module.exports = { dashboard, reports };
