// Printable invoice page (also used for PDF export).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function invoiceHtml(inv, lines, customer, payments) {
  const tax = lines.filter(l => /%$/.test(l.description));
  const items = lines.filter(l => !tax.includes(l));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>
  body { font: 14px/1.5 "Segoe UI", system-ui, sans-serif; color: #1c1f26; margin: 0; background: #fff; }
  .page { max-width: 760px; margin: 0 auto; padding: 40px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1c1f26; padding-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; } .muted { color: #6b7280; } .right { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  td, th { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; border-top: 2px solid #1c1f26; border-bottom: none; font-size: 16px; }
  .stamp { display: inline-block; padding: 2px 10px; border-radius: 4px; font-weight: 600; text-transform: uppercase; font-size: 12px; background: #eef2ff; color: #3730a3; }
  .stamp.paid { background: #dcfce7; color: #166534; } .stamp.overdue { background: #fee2e2; color: #991b1b; } .stamp.cancelled { background: #f3f4f6; color: #6b7280; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .toolbar { position: sticky; top: 0; background: #f8fafc; border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: center; }
  .toolbar button { font: inherit; padding: 6px 14px; margin: 0 4px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print</button><button onclick="window.brightloop ? window.brightloop.savePdf('${esc(inv.number).replace('/', '-')}.pdf') : window.print()">Save as PDF</button></div>
<div class="page">
<header><div><h1>Brightloop Software</h1><div class="muted">Infopark, Kakkanad, Kochi, Kerala · GSTIN 32ABCDE1234F1Z5</div></div>
<div class="right"><h1>Tax invoice</h1><div><b>${esc(inv.number)}</b></div><span class="stamp ${esc(inv.status)}">${esc(inv.status)}</span></div></header>
<div class="grid">
  <div><div class="muted">Bill to</div><b>${esc(customer.name)}</b><br>${esc(customer.address || '')}<br>${esc(customer.email || '')}</div>
  <div class="right"><div><span class="muted">Invoice date</span> ${esc(inv.issue_date)}</div><div><span class="muted">Due date</span> ${esc(inv.due_date)} (Net 30)</div>
  <div><span class="muted">Period</span> ${esc(inv.period_start)} – ${esc(inv.period_end)}</div><div><span class="muted">Subscription</span> ${esc(inv.subscription)}</div></div>
</div>
<table><thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead><tbody>
${items.map(l => `<tr><td>${esc(l.description)}</td><td class="amt">${l.amount < 0 ? '−' + inr(-l.amount) : inr(l.amount)}</td></tr>`).join('')}
<tr><td><b>Taxable amount</b></td><td class="amt"><b>${inr(inv.taxable)}</b></td></tr>
${tax.map(l => `<tr><td>${esc(l.description)}</td><td class="amt">${inr(l.amount)}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="amt">${inr(inv.total)}</td></tr>
${inv.amount_paid ? `<tr><td>Paid</td><td class="amt">−${inr(inv.amount_paid)}</td></tr><tr><td><b>Balance due</b></td><td class="amt"><b>${inr(inv.balance)}</b></td></tr>` : ''}
</tbody></table>
${payments.length ? `<h3 style="margin-top:28px">Payments</h3><table><thead><tr><th>Date</th><th>Method</th><th>Note</th><th class="amt">Amount</th></tr></thead><tbody>
${payments.map(p => `<tr><td>${esc(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.note || '')}</td><td class="amt">${inr(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
<p class="muted" style="margin-top:32px">Thank you for your business. Payment terms: Net 30.</p>
</div></body></html>`;
}

module.exports = { invoiceHtml };
