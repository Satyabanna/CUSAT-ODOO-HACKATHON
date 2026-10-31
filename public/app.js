// LensUS — single-page UI. Talks to the local API; every action is re-checked server-side.
'use strict';

const S = { token: null, me: null, tab: null, lookups: {}, actions: {}, actSeq: 0 };
try { S.token = sessionStorage.getItem('bl_token'); } catch (e) { /* storage unavailable */ }
try { const t = localStorage.getItem('bl_theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

// ---------- helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => (n == null || n === '' ? '—' : (Number(n) < 0 ? '−' : '') + '₹' + Math.abs(Number(n)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inr0 = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fdate = d => (d ? new Date(d.length > 10 ? d.replace(' ', 'T') + 'Z' : d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const can = (tab, need = 'view') => ['none', 'view', 'edit', 'full'].indexOf((S.me?.permissions || {})[tab] || 'none') >= ['none', 'view', 'edit', 'full'].indexOf(need);
const isCustomer = () => S.me?.user.role === 'customer';
const act = fn => { const id = 'a' + (++S.actSeq); S.actions[id] = fn; return `data-a="${id}"`; };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token && !url.startsWith('/api/auth/')) { logout(true); throw new Error('Your session ended. Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', bad ? 'alert' : 'status');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3800);
}
async function busy(btn, fn) {
  if (btn && !(btn instanceof HTMLElement)) btn = null;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + btn.innerHTML; }
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  plans: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  taxes: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  discounts: '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"/><circle cx="7" cy="7" r="1.5"/>',
  templates: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  subscriptions: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  invoices: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8H8M16 12H8M13 16H8"/>',
  payments: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  requests: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  reports: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  aperture: '<circle cx="12" cy="12" r="10"/><path d="m14.31 8 5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  light: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>',
  drone: '<circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7.5 7.5 10 10M16.5 7.5 14 10M7.5 16.5 10 14M16.5 16.5 14 14"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  tripod: '<rect x="8" y="2" width="8" height="5" rx="1"/><path d="M12 7v3M12 10l-6 12M12 10l6 12M12 10v12"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
};
const TYPE_ICON = { Camera: 'camera', Lens: 'aperture', Drone: 'drone', Lighting: 'light', Audio: 'mic', Power: 'battery', Support: 'tripod', Accessory: 'package' };
const typeIcon = t => TYPE_ICON[t] || 'package';
const productImg = (id, rev, alt) => `<img class="pimg" src="/media/product/${id}?v=${rev || 0}" alt="${esc(alt)}" width="400" height="300" loading="lazy" decoding="async">`;
const PRODUCT_TYPES = ['Camera', 'Lens', 'Drone', 'Lighting', 'Audio', 'Power', 'Support', 'Accessory'];
const icon = (name, label) => `<svg class="i" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>${ICONS[name] || ''}</svg>`;

const TAB_INFO = {
  dashboard: ['Dashboard', 'Overview'], users: ['Users & access', 'Admin'], products: ['Cameras & gear', 'Catalogue'], plans: ['Rental plans', 'Catalogue'],
  taxes: ['Taxes', 'Catalogue'], discounts: ['Discounts & flash sales', 'Catalogue'], templates: ['Quote templates', 'Sales'], subscriptions: ['Rentals', 'Sales'],
  invoices: ['Invoices', 'Finance'], payments: ['Payments', 'Finance'], requests: ['Requests', 'Workflow'], reports: ['Reports', 'Finance'],
};
const CUSTOMER_LABELS = { dashboard: 'My summary', plans: 'Rent gear', subscriptions: 'My rentals', invoices: 'My invoices', payments: 'Payment history', requests: 'My requests' };
const tabLabel = t => (isCustomer() && CUSTOMER_LABELS[t]) || TAB_INFO[t][0];

const STATUS_TONE = {
  active: 'ok', paid: 'ok', applied: 'ok', approved: 'ok', live: 'ok',
  draft: '', quotation: 'info', confirmed: 'accent', sent: 'accent', submitted: 'warn', scheduled: 'info',
  paused: 'warn', overdue: 'bad', rejected: 'bad', cancelled: '', closed: '', expired: '', inactive: '', 'used up': '',
};
const badge = s => `<span class="badge ${STATUS_TONE[s] ?? ''}">${esc(s)}</span>`;

function table(cols, rows, empty = 'Nothing here yet') {
  if (!rows.length) return `<div class="empty">${icon('aperture')}<div>${esc(empty)}</div></div>`;
  return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th scope="col" class="${c.num ? 'num' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.v(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const opts = (list, val, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') + list.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val ?? '') ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
const pageHead = (title, sub, actions = '') => `<div class="page-head"><div><div class="eyebrow">${esc(TAB_INFO[S.tab]?.[1] || '')}</div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;

// ---------- modal & forms ----------
let modalReturnFocus = null;
function closeModal() { $('#modal-root').innerHTML = ''; if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus(); }
function openModal({ title, html, wide, footer = '', still }) {
  if (!still) modalReturnFocus = document.activeElement;
  $('#modal-root').innerHTML = `<div class="overlay ${still ? 'still' : ''}"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <header><h1 id="mtitle">${esc(title)}</h1><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></header>
    <div class="body">${html}</div>${footer ? `<footer>${footer}</footer>` : ''}</div></div>`;
  const ov = $('#modal-root .overlay');
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
  ov.querySelector('[data-close]').onclick = closeModal;
  const first = ov.querySelector('.body input, .body select, .body textarea, footer .btn.primary');
  (first || ov.querySelector('[data-close]')).focus();
  return ov;
}

function fieldHtml(f, v) {
  const id = 'f_' + f.name;
  const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const cls = f.full || f.type === 'textarea' ? 'full' : '';
  const common = `id="${id}" name="${f.name}" ${f.required ? 'required aria-required="true"' : ''} ${f.rerender ? 'data-rerender' : ''}`;
  if (f.type === 'static') return `<div class="full">${f.html}</div>`;
  if (f.type === 'check') return `<label class="check ${cls}" for="${id}"><input type="checkbox" ${common} ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  let input;
  if (f.type === 'select') input = `<select ${common}>${opts(f.options, v, f.blank)}</select>`;
  else if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(v ?? '')}</textarea>`;
  else input = `<input type="${f.type || 'text'}" ${common} value="${esc(v ?? '')}" ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.auto ? `autocomplete="${f.auto}"` : ''}>`;
  return `<label class="${cls}" for="${id}"><span>${esc(f.label)}${req}</span>${input}</label>${f.hint ? `<div class="hint">${f.hint}</div>` : ''}`;
}
function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'check') out[f.name] = el.checked;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value;
  }
  return out;
}
// fields may be a function of the current values, so forms can change shape (e.g. request type).
function formModal({ title, fields, values = {}, submit = 'Save', onSubmit, wide, intro = '' }) {
  let vals = { ...values };
  const getFields = () => (typeof fields === 'function' ? fields(vals) : fields).filter(Boolean);
  let drawn = false;
  const draw = () => {
    const fs = getFields();
    const ov = openModal({ title, wide, still: drawn, html: `${intro}<div class="err" role="alert" hidden></div><form class="form" novalidate>${fs.map(f => fieldHtml(f, vals[f.name])).join('')}<button type="submit" hidden></button></form>`,
      footer: `<button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-submit>${esc(submit)}</button>` });
    const form = ov.querySelector('form'), err = ov.querySelector('.err'), btn = ov.querySelector('[data-submit]');
    ov.querySelector('[data-cancel]').onclick = closeModal;
    form.querySelectorAll('[data-rerender]').forEach(el => el.addEventListener('change', () => { vals = { ...vals, ...readForm(form, getFields()) }; draw(); const again = $(`#modal-root [name="${el.name}"]`); if (again) again.focus(); }));
    const go = async e => {
      e && e.preventDefault();
      vals = { ...vals, ...readForm(form, fs) };
      const missing = fs.filter(f => f.required && (vals[f.name] === '' || vals[f.name] == null));
      if (missing.length) { err.hidden = false; err.textContent = 'Please fill in: ' + missing.map(f => f.label).join(', '); form.querySelector(`[name="${missing[0].name}"]`).focus(); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(submit);
      try { const keep = await onSubmit(vals); if (keep !== 'keep') closeModal(); }
      catch (x) { err.hidden = false; err.textContent = x.message; err.scrollIntoView({ block: 'nearest' }); }
      finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = submit; } }
    };
    btn.onclick = go;
    form.onsubmit = go;
    drawn = true;
  };
  draw();
}
function confirmModal(title, text, onYes, { danger, yes = 'Confirm', comment } = {}) {
  formModal({ title, submit: yes, intro: `<p>${text}</p>`, fields: comment ? [{ name: 'comment', label: comment.label, type: 'textarea', required: comment.required }] : [{ type: 'static', name: '_', html: '' }],
    onSubmit: async v => onYes(v) });
  if (danger) { const b = $('#modal-root [data-submit]'); b.classList.remove('primary'); b.classList.add('danger'); }
}

// ---------- auth screens ----------
function logout(silent) {
  if (!silent && S.token) api('POST', '/api/auth/logout').catch(() => {});
  S.token = null; S.me = null;
  clearDeck();
  try { sessionStorage.removeItem('bl_token'); sessionStorage.removeItem('bl_deck_seen'); } catch (e) { /* ignore */ }
  renderAuth('login');
}
async function setSession(token) {
  S.token = token;
  try { sessionStorage.setItem('bl_token', token); } catch (e) { /* ignore */ }
  await loadMe();
  const first = Object.keys(TAB_INFO).find(t => can(t));
  location.hash = '#/' + (isCustomer() && S.me.permissions.plans !== 'none' && S.firstVisit ? 'plans' : first);
  renderShell();
  maybeAutoDeck();
}
async function loadMe() {
  S.me = await api('GET', '/api/me');
  S.lookups = isCustomer() ? {} : await api('GET', '/api/lookups');
}

const DEMO = [
  ['Anita', 'Admin', 'anita@brightloop.in', 'Admin@123'], ['Rahul', 'Sales staff', 'rahul@brightloop.in', 'Staff@123'],
  ['Meera', 'Finance staff', 'meera@brightloop.in', 'Staff@123'], ['Malabar Logistics', 'Customer', 'accounts@malabarlogistics.in', 'Malabar@123'],
];
const PW_HINT = 'At least 8 characters with an uppercase letter, a lowercase letter, a digit and a symbol.';
function renderAuth(mode, notice) {
  S.actions = {};
  const panels = {
    login: `<h1>Sign in</h1><p class="muted">Staff, admins and customers all sign in here.</p>
      <form id="auth"><label for="email">Email<input id="email" name="email" type="email" autocomplete="username" required></label>
      <label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required></label>
      <label class="check" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="showpw"> Show password</label>
      <button class="btn primary" type="submit">Sign in</button></form>
      <div class="row" style="justify-content:space-between;margin-top:12px"><a href="#" ${act(() => renderAuth('signup'))}>Create a customer account</a><a href="#" ${act(() => renderAuth('forgot'))}>Forgot password?</a></div>
      <div class="demo"><div class="muted" style="margin-bottom:6px">Demo accounts — click to fill</div>
      ${DEMO.map(d => `<button type="button" ${act(() => { $('#email').value = d[2]; $('#password').value = d[3]; $('#password').focus(); })}><span><b>${esc(d[0])}</b> <span class="muted">· ${esc(d[1])}</span></span><span class="mono muted" style="font-size:12px">${esc(d[3])}</span></button>`).join('')}</div>`,
    signup: `<h1>Create your account</h1><p class="muted">Rent cameras, lenses and accessories on a plan that fits your shoots.</p>
      <form id="auth"><label for="company">Company<input id="company" name="company" required autocomplete="organization"></label>
      <label for="name">Your name<input id="name" name="name" required autocomplete="name"></label>
      <label for="email">Work email<input id="email" name="email" type="email" required autocomplete="email"></label>
      <label for="phone">Phone<input id="phone" name="phone" type="tel" autocomplete="tel"></label>
      <label for="password">Password<input id="password" name="password" type="password" required autocomplete="new-password" aria-describedby="pwh"></label>
      <div id="pwh" class="muted" style="font-size:12px;margin-top:-8px">${PW_HINT}</div>
      <button class="btn primary" type="submit">Create account</button></form>
      <p style="margin-top:12px"><a href="#" ${act(() => renderAuth('login'))}>I already have an account</a></p>`,
    forgot: `<h1>Reset your password</h1><p class="muted">We'll generate a reset code. Email is simulated in this offline build, so the code is shown here and in your in-app inbox.</p>
      <form id="auth"><label for="email">Email<input id="email" name="email" type="email" required autocomplete="email"></label><button class="btn primary" type="submit">Send reset code</button></form>
      <p style="margin-top:12px"><a href="#" ${act(() => renderAuth('reset'))}>I have a code</a> · <a href="#" ${act(() => renderAuth('login'))}>Back to sign in</a></p>`,
    reset: `<h1>Choose a new password</h1>
      <form id="auth"><label for="code">Reset code<input id="code" name="code" required class="mono" value="${esc(notice?.code || '')}"></label>
      <label for="password">New password<input id="password" name="password" type="password" required autocomplete="new-password" aria-describedby="pwh"></label>
      <div id="pwh" class="muted" style="font-size:12px;margin-top:-8px">${PW_HINT}</div><button class="btn primary" type="submit">Set password</button></form>
      <p style="margin-top:12px"><a href="#" ${act(() => renderAuth('login'))}>Back to sign in</a></p>`,
  };
  $('#app').innerHTML = `<div class="auth">
    <section class="hero" aria-hidden="true"><div class="brand" style="padding:0"><span class="logo">${icon('aperture')}</span><span><b>LENSUS</b><small>Camera &amp; gear rentals</small></span></div>
      <div class="lens"></div>
      <div><h1>Rent pro cameras <em>&amp; accessories.</em><br>Shoot more, own less.</h1><p>Mirrorless and cinema bodies, drones, lenses, lights and audio, on flexible monthly or yearly rental plans with GST invoicing built in.</p></div>
      <div class="stats"><div><b>15+</b><span>Bodies, lenses &amp; kits</span></div><div><b>Monthly</b><span>Pause or return anytime*</span></div><div><b>Flash</b><span>Weekly deals</span></div></div></section>
    <section class="panel"><div class="card">${notice?.ok ? `<div class="ok-box" role="status">${esc(notice.ok)}</div>` : ''}<div class="err" role="alert" hidden></div>${panels[mode]}</div></section></div>`;
  const form = $('#auth');
  const sp = $('#showpw'); if (sp) sp.onchange = () => { $('#password').type = sp.checked ? 'text' : 'password'; };
  form.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const err = $('.auth .err'), btn = form.querySelector('button[type=submit]');
    err.hidden = true;
    await busy(btn, async () => {
      try {
        if (mode === 'login') await setSession((await api('POST', '/api/auth/login', v)).token);
        else if (mode === 'signup') { S.firstVisit = true; await setSession((await api('POST', '/api/auth/signup', v)).token); toast('Welcome! Pick a plan to get started.'); }
        else if (mode === 'forgot') { const r = await api('POST', '/api/auth/forgot', v); renderAuth('reset', { ok: r.reset_code ? `Reset code: ${r.reset_code}` : r.message, code: r.reset_code }); }
        else if (mode === 'reset') { await api('POST', '/api/auth/reset', v); renderAuth('login', { ok: 'Password updated. Sign in with your new password.' }); }
      } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  };
  const firstInput = form.querySelector('input'); if (firstInput) firstInput.focus();
}

// ---------- shell ----------
function renderShell() {
  const tabs = Object.keys(TAB_INFO).filter(t => can(t));
  const want = (location.hash.match(/^#\/(\w+)/) || [])[1];
  S.tab = tabs.includes(want) ? want : tabs[0];
  const u = S.me.user;
  const canSetDate = can('users', 'full');
  const theme = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  S.actions = {};
  $('#app').innerHTML = `<a class="skip" href="#main">Skip to content</a><div class="shell">
    <aside class="side" aria-label="Main navigation">
      <div class="brand"><span class="logo">${icon('aperture')}</span><span><b>LENSUS</b><small>${isCustomer() ? 'Rental portal' : 'Rental desk'}</small></span></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">${tabs.map(t => `<button type="button" class="${t === S.tab ? 'active' : ''}" ${t === S.tab ? 'aria-current="page"' : ''} ${act(() => { location.hash = '#/' + t; })}>
        ${icon(t === 'products' ? 'camera' : t)}<span class="t">${esc(tabLabel(t))}</span>${!isCustomer() && S.me.permissions[t] !== 'full' ? `<span class="lvl">${esc(S.me.permissions[t])}</span>` : ''}</button>`).join('')}</nav>
      <div class="foot"><div class="who"><span class="avatar" aria-hidden="true">${esc(u.name.slice(0, 1))}</span><div style="min-width:0"><b>${esc(u.name)}</b><div class="muted" style="font-size:12px">${esc(isCustomer() ? S.me.customer?.name : (u.title ? u.title + ' · ' : '') + u.role)}</div></div></div>
        <div class="row" style="margin-top:10px"><button class="btn sm" type="button" ${act(changePassword)}>${icon('key')}Password</button><button class="btn sm danger" type="button" ${act(() => logout())}>${icon('logout')}Sign out</button></div></div>
    </aside>
    <div class="main"><header class="top"><span class="crumb">${esc(TAB_INFO[S.tab][1])} / ${esc(tabLabel(S.tab))}</span><span class="spacer"></span>
      <label class="datebox" title="Business date used for billing, due dates and expiries"><span class="pulse" aria-hidden="true"></span><span>Business date</span>
        ${canSetDate ? `<input type="date" id="bizdate" value="${esc(S.me.today)}" aria-label="Business date">` : `<b>${esc(fdate(S.me.today))}</b>`}</label>
      <button class="iconbtn" type="button" aria-label="Switch to ${theme === 'dark' ? 'light' : 'dark'} theme" ${act(toggleTheme)}>${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
      <button class="iconbtn" type="button" aria-label="Notifications, ${S.me.unread} unread" ${act(showInbox)}>${icon('bell')}${S.me.unread ? `<span class="dot">${S.me.unread > 99 ? '99+' : S.me.unread}</span>` : ''}</button>
    </header><main id="main" class="content" tabindex="-1"><div class="empty">Loading…</div></main></div></div>`;
  const bd = $('#bizdate');
  if (bd) bd.onchange = () => busy(null, async () => {
    const r = await api('PUT', '/api/settings/date', { date: bd.value });
    toast(`Business date set to ${fdate(r.today)}. Scheduled jobs ran (expiries, renewals, overdue checks).`);
    await loadMe(); renderShell();
  });
  renderView();
}
async function renderView() {
  const main = $('#main');
  const keep = S.actions;
  S.actions = Object.fromEntries(Object.entries(keep).filter(([k]) => document.querySelector(`.side [data-a="${k}"], .top [data-a="${k}"]`)));
  try { main.innerHTML = await VIEWS[S.tab](); }
  catch (e) { main.innerHTML = `<div class="err" role="alert">${esc(e.message)}</div>`; }
  wireView && wireView(); wireView = null;
}
let wireView = null; // views can set a function to attach listeners after render
async function refresh() { S.me = await api('GET', '/api/me'); if (!isCustomer()) S.lookups = await api('GET', '/api/lookups'); renderShell(); }
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('bl_theme', next); } catch (e) { /* ignore */ }
  renderShell();
}
async function showInbox() {
  const list = await api('GET', '/api/notifications');
  openModal({ title: 'Notifications', html: list.length ? list.map(n => `<div class="notif ${n.is_read ? '' : 'unread'}"><div>${esc(n.message)}</div><div class="when">${esc(n.kind)} · ${esc(fdate(n.at))}</div></div>`).join('') : '<div class="empty">No notifications</div>' });
  if (S.me.unread) { await api('POST', '/api/notifications/read'); S.me.unread = 0; const d = $('.top .dot'); if (d) d.remove(); }
}
function changePassword() {
  formModal({ title: 'Change password', submit: 'Update password', fields: [
    { name: 'current', label: 'Current password', type: 'password', required: true, full: true, auto: 'current-password' },
    { name: 'password', label: 'New password', type: 'password', required: true, full: true, auto: 'new-password', hint: PW_HINT }],
  onSubmit: async v => { await api('POST', '/api/me/password', v); toast('Password updated'); } });
}

// ---------- requests (shared) ----------
function requestFields(vals) {
  const L = S.lookups;
  const subs = S._subsForReq || [];
  const plans = (S._plansForReq || []).filter(p => p.active);
  const subOpts = subs.map(s => ({ v: s.id, l: `${s.number} · ${s.customer} · ${s.plan_name} (${s.state})` }));
  const prodOpts = (L.products || []).map(p => ({ v: p.id, l: p.name }));
  const types = S._reqTypes || [];
  const base = [{ name: 'type', label: 'Request type', type: 'select', options: types.map(t => ({ v: t.value, l: t.label })), required: true, rerender: true, full: true },
    { name: 'title', label: 'Short title', full: true }];
  const t = vals.type;
  const per = {
    discount: [{ name: 'code', label: 'Discount code', required: true }, { name: 'dtype', label: 'Type', type: 'select', options: [{ v: 'percent', l: 'Percent off' }, { v: 'fixed', l: 'Fixed amount (₹)' }] },
      { name: 'value', label: 'Value', type: 'number', required: true, min: 0 }, { name: 'min_qty', label: 'Minimum quantity', type: 'number', min: 1 },
      { name: 'start_date', label: 'Valid from', type: 'date' }, { name: 'end_date', label: 'Valid until', type: 'date' },
      { name: 'usage_limit', label: 'Usage limit', type: 'number', min: 1 }, { name: 'product_id', label: 'Applies to product', type: 'select', options: prodOpts, blank: 'Any product' }],
    custom_price: [{ name: 'subscription_id', label: 'Subscription', type: 'select', options: subOpts, required: true, full: true }, { name: 'price', label: 'Custom unit price (₹)', type: 'number', required: true, min: 0 }],
    plan: [{ name: 'plan_id', label: 'Change existing plan (new version)', type: 'select', options: plans.map(p => ({ v: p.id, l: `${p.name} v${p.version}` })), blank: '— New plan —', full: true },
      { name: 'name', label: 'Plan name', required: true }, { name: 'product_id', label: 'Product', type: 'select', options: prodOpts, required: true },
      { name: 'price', label: 'Price (₹)', type: 'number', required: true, min: 0 }, { name: 'period', label: 'Billing period', type: 'select', options: [{ v: 'month', l: 'Monthly' }, { v: 'year', l: 'Yearly' }] },
      { name: 'min_qty', label: 'Minimum quantity', type: 'number', min: 1 }, { name: 'term_periods', label: 'Term length (periods)', type: 'number', min: 1 },
      { name: 'pausable', label: 'Pausable', type: 'check' }, { name: 'closable', label: 'Closable early', type: 'check' }, { name: 'renewable', label: 'Renewable', type: 'check' }, { name: 'auto_close', label: 'Auto-close at end date', type: 'check' }],
    product: [{ name: 'product_id', label: 'Add a variant to', type: 'select', options: prodOpts, blank: '— New product —', rerender: true, full: true },
      ...(vals.product_id ? [{ name: 'attribute', label: 'Attribute (e.g. Lens kit)', required: true }, { name: 'value', label: 'Value (e.g. 85mm f/1.4)', required: true }, { name: 'extra_price', label: 'Extra price (₹)', type: 'number', min: 0 }]
        : [{ name: 'name', label: 'Product name', required: true }, { name: 'ptype', label: 'Type', type: 'select', options: PRODUCT_TYPES.map(x => ({ v: x, l: x })) },
          { name: 'sales_price', label: 'Sales price (₹)', type: 'number', min: 0 }, { name: 'cost_price', label: 'Cost price (₹)', type: 'number', min: 0 }])],
    sub_close: [{ name: 'subscription_id', label: 'Subscription', type: 'select', options: subOpts, required: true, full: true }],
    sub_pause: [{ name: 'subscription_id', label: 'Subscription', type: 'select', options: subOpts, required: true, full: true }],
    sub_resume: [{ name: 'subscription_id', label: 'Subscription', type: 'select', options: subOpts, required: true, full: true }],
    sub_upgrade: [{ name: 'subscription_id', label: 'Subscription', type: 'select', options: subOpts, required: true, full: true },
      { name: 'new_plan_id', label: 'New plan', type: 'select', options: plans.map(p => ({ v: p.id, l: `${p.name} — ${inr0(p.price)}/${p.period}` })), required: true, full: true },
      { type: 'static', name: '_n', html: '<div class="hint">Plan changes take effect from the next billing period.</div>' }],
    refund: [{ name: 'invoice_id', label: 'Invoice', type: 'select', options: (L.invoices || []).filter(i => i.amount_paid > 0).map(i => ({ v: i.id, l: `${i.number} · paid ${inr(i.amount_paid)}` })), required: true, full: true },
      { name: 'amount', label: 'Refund amount (₹)', type: 'number', required: true, min: 0 }, { name: 'reason', label: 'Reason', type: 'textarea' }],
  };
  return [...base, ...(per[t] || [])];
}
function requestPayload(v) {
  const p = { ...v }; delete p.type; delete p.title; delete p._n;
  if (v.type === 'discount') { p.type = v.dtype || 'percent'; delete p.dtype; }
  if (v.type === 'product' && !v.product_id) { p.type = v.ptype || 'Camera'; delete p.ptype; }
  for (const k of ['subscription_id', 'product_id', 'plan_id', 'new_plan_id', 'invoice_id']) if (p[k] === '') delete p[k]; else if (p[k] != null) p[k] = Number(p[k]);
  for (const k of Object.keys(p)) if (p[k] === null || p[k] === '') delete p[k];
  return p;
}
async function newRequest(preset = {}) {
  [S._reqTypes, S._subsForReq, S._plansForReq] = await Promise.all([api('GET', '/api/requests/types'),
    can('subscriptions') ? api('GET', '/api/subscriptions') : [], can('plans') ? api('GET', '/api/plans') : []]);
  const values = { type: S._reqTypes[0]?.value, dtype: 'percent', period: 'month', closable: true, ...preset };
  formModal({ title: 'Raise a request', submit: 'Submit for approval', wide: true, values,
    intro: `<p class="muted" style="margin-top:0">${isCustomer() ? 'Our team reviews every request; you\'ll get a notification with the decision.' : 'Pricing and policy changes go to the admin. When approved, the record is created automatically.'}</p>`,
    fields: requestFields,
    onSubmit: async v => {
      const r = await api('POST', '/api/requests', { type: v.type, title: v.title || undefined, payload: requestPayload(v), submit: true });
      toast(`Request #${r.id} submitted`); if (S.tab === 'requests' || S.tab === 'subscriptions') renderView();
    } });
}
async function quickRequest(type, payload, title, { text, comment } = {}) {
  confirmModal(title, text || 'This will be sent for approval.', async v => {
    const r = await api('POST', '/api/requests', { type, title, payload, submit: true, ...(v.comment ? { title: `${title}: ${v.comment}` } : {}) });
    toast(`Request #${r.id} submitted for approval`); renderView();
  }, { yes: 'Submit request', comment });
}

// ---------- views ----------
const VIEWS = {};

VIEWS.dashboard = async () => {
  if (isCustomer()) {
    const d = await api('GET', '/api/dashboard');
    return pageHead(`Hello, ${S.me.customer?.name || S.me.user.name}`, 'Your rentals, invoices and payments at a glance.') + `
      <div class="tiles"><div class="tile"><div class="k">Active rentals</div><div class="v">${d.active_subscriptions}</div></div>
      <div class="tile"><div class="k">Quotes waiting</div><div class="v">${d.quotes_waiting}</div>${d.quotes_waiting ? '<div class="s">Review under My rentals</div>' : ''}</div>
      <div class="tile"><div class="k">Outstanding</div><div class="v">${inr(d.outstanding)}</div></div>
      <div class="tile ${d.overdue_amount ? 'bad' : ''}"><div class="k">Overdue</div><div class="v">${inr(d.overdue_amount)}</div></div>
      <div class="tile"><div class="k">Next invoice</div><div class="v" style="font-size:18px">${fdate(d.next_invoice)}</div></div></div>
      <div class="grid2"><div class="card flush"><h2>Overdue invoices</h2>${table([{ h: 'Invoice', v: r => `<a href="#" ${act(() => showInvoice(r.id))}>${esc(r.number)}</a>` }, { h: 'Due', v: r => fdate(r.due_date) }, { h: 'Balance', num: 1, v: r => inr(r.balance) }], d.overdue_invoices, 'Nothing overdue — thank you!')}</div>
      <div class="card flush"><h2>Recent payments</h2>${table([{ h: 'Date', v: r => fdate(r.date) }, { h: 'Invoice', v: r => esc(r.invoice) }, { h: 'Method', v: r => esc(r.method) }, { h: 'Amount', num: 1, v: r => inr(r.amount) }], d.recent_payments, 'No payments yet')}</div></div>`;
  }
  const f = S.dashFilters || (S.dashFilters = {});
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const d = await api('GET', '/api/dashboard' + (q ? '?' + q : ''));
  const L = S.lookups;
  const states = Object.entries(d.by_state);
  const maxState = Math.max(1, ...states.map(s => s[1]));
  wireView = () => document.querySelectorAll('.filters [name]').forEach(el => el.addEventListener('change', () => { f[el.name] = el.value; renderView(); }));
  return pageHead('Finance dashboard', `Figures as of ${fdate(d.today)}. Revenue collected covers ${fdate(d.from)} – ${fdate(d.to)}.`,
    can('invoices', 'edit') ? `<button class="btn primary" type="button" ${act(e => runBilling(e.currentTarget))}>${icon('play')}Run billing</button>` : '') + `
    <div class="filters" role="group" aria-label="Filters">
      <label>From<input type="date" name="from" value="${esc(f.from || d.from)}"></label><label>To<input type="date" name="to" value="${esc(f.to || d.to)}"></label>
      <label>Plan<select name="plan_id">${opts((L.plans || []).map(p => ({ v: p.id, l: `${p.name} v${p.version}` })), f.plan_id, 'All plans')}</select></label>
      <label>Customer<select name="customer_id">${opts((L.customers || []).map(c => ({ v: c.id, l: c.name })), f.customer_id, 'All customers')}</select></label>
      <label>Status<select name="status">${opts(['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed', 'expired', 'cancelled'].map(s => ({ v: s, l: s })), f.status, 'Any status')}</select></label>
      <label>Staff<select name="staff_id">${opts((L.staff || []).map(s => ({ v: s.id, l: s.name })), f.staff_id, 'All staff')}</select></label>
      ${Object.values(f).some(Boolean) ? `<button class="btn sm ghost" type="button" ${act(() => { S.dashFilters = {}; renderView(); })}>Clear</button>` : ''}</div>
    <div class="tiles">
      <div class="tile hero"><div class="k">Monthly recurring revenue</div><div class="v">${inr(d.mrr)}</div><div class="s">Active rentals normalised to a month, after discount, before tax</div></div>
      <div class="tile"><div class="k">Active rentals</div><div class="v">${d.active_subscriptions}</div></div>
      <div class="tile"><div class="k">Collected in range</div><div class="v">${inr(d.revenue_collected)}</div></div>
      <div class="tile"><div class="k">Outstanding</div><div class="v">${inr(d.outstanding)}</div></div>
      <div class="tile ${d.overdue_count ? 'bad' : ''}"><div class="k">Overdue invoices</div><div class="v">${d.overdue_count}</div></div>
      <div class="tile"><div class="k">Pending requests</div><div class="v">${d.pending_requests}</div></div></div>
    <div class="grid2"><div class="card flush"><h2>Invoices to chase</h2>${table([
      { h: 'Invoice', v: r => `<a href="#" ${act(() => showInvoice(r.id))}>${esc(r.number)}</a>` }, { h: 'Customer', v: r => esc(r.customer) },
      { h: 'Due', v: r => fdate(r.due_date) }, { h: 'Days late', num: 1, v: r => `<span class="badge bad">${r.days_overdue}d</span>` }, { h: 'Balance', num: 1, v: r => inr(r.balance) }], d.to_chase, 'No overdue invoices')}</div>
      <div class="card"><h2>Rentals by state</h2>${states.length ? states.map(([s, n]) => `<div class="row" style="margin:8px 0"><span style="width:100px">${badge(s)}</span><div class="bar" style="flex:1"><span style="width:${(n / maxState) * 100}%"></span></div><span class="mono" style="width:28px;text-align:right">${n}</span></div>`).join('') : '<div class="empty">No rentals</div>'}</div></div>
    <div class="card flush"><h2>Rentals</h2>${table([
      { h: 'Number', v: r => `<a href="#" ${act(() => showSubscription(r.id))} class="code">${esc(r.number)}</a>` }, { h: 'Customer', v: r => esc(r.customer) }, { h: 'Plan', v: r => esc(r.plan) },
      { h: 'State', v: r => badge(r.state) }, { h: 'Next invoice', v: r => fdate(r.next_invoice_date) }, { h: 'MRR', num: 1, v: r => (r.mrr ? inr(r.mrr) : '—') }], d.subscriptions, 'No rentals match these filters')}</div>`;
};
async function runBilling(btn) {
  await busy(btn, async () => {
    const r = await api('POST', '/api/billing/run');
    toast(r.created.length ? `Created ${r.created.length} draft invoice(s): ${r.created.map(c => c.number).join(', ')}` : `Nothing to bill on ${fdate(r.date)} — every active subscription is already invoiced for its current period.`);
    S.lookups = await api('GET', '/api/lookups');
    renderView();
  });
}

// --- users & access
VIEWS.users = async () => {
  const sub = S.usersTab || 'users';
  const tabs = `<div class="tabs" role="tablist">${[['users', 'Users'], ['roles', 'Role defaults'], ['audit', 'Audit log']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === sub}" class="${k === sub ? 'active' : ''}" ${act(() => { S.usersTab = k; renderView(); })}>${l}</button>`).join('')}</div>`;
  const full = can('users', 'full');
  if (sub === 'roles') {
    const rows = await api('GET', '/api/role-permissions');
    const lv = (role, tab) => (rows.find(r => r.role === role && r.tab === tab) || {}).level || 'none';
    wireView = () => document.querySelectorAll('[data-rp]').forEach(el => el.addEventListener('change', () => busy(null, async () => {
      const [role, tab] = el.dataset.rp.split(':');
      await api('PUT', '/api/role-permissions', { role, tab, level: el.value }); toast(`Default for ${role} on ${TAB_INFO[tab][0]} set to ${el.value}`);
    })));
    return pageHead('Users & access', 'Default tab access per role. Individual users can be overridden from the Users list.') + tabs + `<div class="card flush perm-grid">${table([
      { h: 'Tab', v: t => esc(TAB_INFO[t][0]) },
      ...['admin', 'staff', 'customer'].map(role => ({ h: role, v: t => (full ? `<select data-rp="${role}:${t}" aria-label="${role} access to ${TAB_INFO[t][0]}">${opts(['none', 'view', 'edit', 'full'].map(x => ({ v: x, l: x })), lv(role, t))}</select>` : esc(lv(role, t))) }))], Object.keys(TAB_INFO))}</div>`;
  }
  if (sub === 'audit') {
    const rows = await api('GET', '/api/audit?limit=500');
    return pageHead('Users & access', 'Every state change, approval and permission edit, newest first.') + tabs + `<div class="card flush">${table([
      { h: 'When', v: r => `<span class="mono" style="font-size:12px">${esc(r.at)}</span>` }, { h: 'Who', v: r => esc(r.user || 'System') }, { h: 'Action', v: r => `<span class="code">${esc(r.action)}</span>` },
      { h: 'Record', v: r => (r.entity ? `${esc(r.entity)}${r.entity_id ? ' #' + r.entity_id : ''}` : '—') }, { h: 'Details', v: r => `<span class="muted mono" style="font-size:12px;word-break:break-word">${esc(r.details || '')}</span>` }], rows)}</div>`;
  }
  const users = await api('GET', '/api/users');
  return pageHead('Users & access', 'Create staff, deactivate accounts (never deleted, so invoices keep their history), reset passwords and tune tab access.',
    full ? `<button class="btn primary" type="button" ${act(newUser)}>${icon('plus')}New staff user</button>` : '') + tabs + `<div class="card flush">${table([
    { h: 'Name', v: u => `<b>${esc(u.name)}</b><div class="muted" style="font-size:12px">${esc(u.email)}</div>` },
    { h: 'Role', v: u => `<span class="badge ${u.role === 'admin' ? 'accent' : u.role === 'staff' ? 'info' : ''}">${esc(u.role)}</span>` },
    { h: 'Team / company', v: u => esc(u.company || u.title || '—') }, { h: 'Status', v: u => (u.active ? badge('active') : '<span class="badge bad">deactivated</span>') },
    { h: '', v: u => `<div class="row">${full ? `<button class="btn sm" type="button" ${act(() => editAccess(u))}>Access</button><button class="btn sm" type="button" ${act(() => editUser(u))}>Edit</button>
      <button class="btn sm" type="button" ${act(() => resetPw(u))}>Reset password</button>${u.id === S.me.user.id ? '' : `<button class="btn sm ${u.active ? 'danger' : ''}" type="button" ${act(() => toggleUser(u))}>${u.active ? 'Deactivate' : 'Reactivate'}</button>`}` : `<button class="btn sm" type="button" ${act(() => editAccess(u))}>View access</button>`}</div>` }], users)}</div>`;
};
function newUser() {
  formModal({ title: 'New staff user', submit: 'Create user', values: { role: 'staff' }, fields: [
    { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', options: [{ v: 'staff', l: 'Internal staff' }, { v: 'admin', l: 'Admin' }] }, { name: 'title', label: 'Team (e.g. Sales, Finance)' },
    { name: 'password', label: 'Temporary password', type: 'text', required: true, full: true, hint: PW_HINT }],
  onSubmit: async v => { await api('POST', '/api/users', v); toast('User created'); refresh(); } });
}
function editUser(u) {
  formModal({ title: `Edit ${u.name}`, values: u, fields: [
    { name: 'name', label: 'Name', required: true }, { name: 'title', label: 'Team / title' },
    u.role !== 'customer' && { name: 'role', label: 'Role', type: 'select', options: [{ v: 'staff', l: 'Internal staff' }, { v: 'admin', l: 'Admin' }], full: true }],
  onSubmit: async v => { await api('PUT', `/api/users/${u.id}`, v); toast('User updated'); refresh(); } });
}
function resetPw(u) {
  formModal({ title: `Reset password · ${u.name}`, submit: 'Reset password', fields: [{ name: 'password', label: 'New password', required: true, full: true, hint: PW_HINT }],
    onSubmit: async v => { await api('POST', `/api/users/${u.id}/reset-password`, v); toast('Password reset; the user was notified'); } });
}
function toggleUser(u) {
  confirmModal(u.active ? `Deactivate ${u.name}?` : `Reactivate ${u.name}?`, u.active ? 'They will be signed out and unable to sign in. Their invoices and history are kept.' : 'They will be able to sign in again.',
    async () => { await api('PUT', `/api/users/${u.id}`, { active: u.active ? 0 : 1 }); toast(u.active ? 'User deactivated' : 'User reactivated'); renderView(); }, { danger: u.active, yes: u.active ? 'Deactivate' : 'Reactivate' });
}
async function editAccess(u) {
  const p = await api('GET', `/api/users/${u.id}/permissions`);
  const full = can('users', 'full');
  const ov = openModal({ title: `Tab access · ${u.name} (${u.role})`, wide: true,
    html: `<p class="muted" style="margin-top:0">Overrides win over the ${esc(u.role)} role default. Choose “Role default” to remove an override.</p><div class="err" role="alert" hidden></div>
      <div class="card flush perm-grid" style="box-shadow:none">${table([{ h: 'Tab', v: t => esc(TAB_INFO[t][0]) }, { h: 'Role default', v: t => esc(p.defaults[t] || 'none') },
      { h: 'Override', v: t => (full ? `<select data-tab="${t}" aria-label="Override for ${TAB_INFO[t][0]}">${opts([{ v: 'default', l: 'Role default' }, ...['none', 'view', 'edit', 'full'].map(x => ({ v: x, l: x }))], p.overrides[t] || 'default')}</select>` : esc(p.overrides[t] || '—')) },
      { h: 'Effective', v: t => `<span class="badge ${p.effective[t] === 'none' ? '' : 'accent'}">${esc(p.effective[t])}</span>` }], p.tabs)}</div>`,
    footer: full ? '<button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save access</button>' : '' });
  if (!full) return;
  ov.querySelector('[data-cancel]').onclick = closeModal;
  ov.querySelector('[data-save]').onclick = e => busy(e.currentTarget, async () => {
    const body = {}; ov.querySelectorAll('select[data-tab]').forEach(s => { body[s.dataset.tab] = s.value; });
    try { await api('PUT', `/api/users/${u.id}/permissions`, body); closeModal(); toast('Access updated and logged'); if (u.id === S.me.user.id) refresh(); }
    catch (x) { const err = ov.querySelector('.err'); err.hidden = false; err.textContent = x.message; }
  });
}

// --- catalogue
VIEWS.products = async () => {
  const [products, taxes] = await Promise.all([api('GET', '/api/products'), can('taxes') ? api('GET', '/api/taxes') : []]);
  const full = can('products', 'full');
  return pageHead('Cameras & gear', 'Bodies, lenses and accessories that plans are built from.',
    full ? `<button class="btn primary" type="button" ${act(() => editProduct(null, taxes))}>${icon('plus')}New product</button>` : `<button class="btn" type="button" ${act(() => newRequest({ type: 'product' }))}>Request product or variant</button>`) + `
    <div class="plan-cards">${products.map(p => `<article class="card plan-card" style="margin:0">
      <div class="art">${productImg(p.id, p.image_rev, p.name)}${p.has_photo ? '<span class="photo-tag">photo</span>' : ''}</div>
      <div class="row" style="justify-content:space-between"><span class="badge info">${esc(p.type)}</span>${p.active ? '' : '<span class="badge">archived</span>'}</div>
      <h3 style="margin:4px 0 0">${esc(p.name)}</h3>
      <div class="price">${inr0(p.sales_price)} <small>sales · cost ${inr0(p.cost_price)}</small></div>
      <div class="spec"><span>${esc(p.tax_name ? `${p.tax_name} ${p.tax_rate}%` : 'No tax')}</span><span>margin ${p.sales_price ? Math.round((1 - p.cost_price / p.sales_price) * 100) : 0}%</span></div>
      ${p.variants.length ? `<div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.1em" class="mono">Variants</div>${p.variants.map(v => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(v.attribute)}: <b>${esc(v.value)}</b>${v.active ? '' : ' <span class="badge">archived</span>'}</span><span class="row"><span class="mono">+${inr0(v.extra_price)}</span>${full ? `<button class="btn sm ghost" type="button" ${act(() => editVariant(p, v))}>Edit</button>` : ''}</span></div>`).join('')}` : '<div class="muted">No variants</div>'}
      ${full ? `<div class="row" style="margin-top:auto;padding-top:10px"><button class="btn sm" type="button" ${act(() => editProduct(p, taxes))}>Edit</button><button class="btn sm" type="button" ${act(() => editVariant(p, null))}>${icon('plus')}Variant</button>
        <button class="btn sm" type="button" ${act(e => uploadPhoto(p, e.currentTarget))}>Upload photo</button>${p.has_photo ? `<button class="btn sm ghost" type="button" ${act(() => removePhoto(p))}>Remove photo</button>` : ''}</div>` : ''}
    </article>`).join('') || '<div class="empty">No products yet</div>'}</div>`;
};
// Product photos: resized in the browser (max 1200px, WebP) before upload so the database stays small.
function uploadPhoto(p, btn) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  input.onchange = () => busy(btn, async () => {
    const file = input.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image');
    const src = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('Could not read the file')); r.readAsDataURL(file); });
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file is not a readable image')); i.src = src; });
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    await api('PUT', `/api/products/${p.id}/image`, { data_url: canvas.toDataURL('image/webp', 0.86) });
    toast(`Photo updated for ${p.name}`); renderView();
  });
  input.click();
}
function removePhoto(p) {
  confirmModal(`Remove photo of ${p.name}?`, 'The product goes back to its built-in illustration.', async () => {
    await api('DELETE', `/api/products/${p.id}/image`); toast('Photo removed'); renderView();
  }, { danger: true, yes: 'Remove photo' });
}
function editProduct(p, taxes) {
  formModal({ title: p ? `Edit ${p.name}` : 'New product', values: p || { type: 'Camera', tax_id: taxes[0]?.id }, fields: [
    { name: 'name', label: 'Name', required: true, full: true }, { name: 'type', label: 'Type', type: 'select', options: PRODUCT_TYPES.map(x => ({ v: x, l: x })) },
    { name: 'tax_id', label: 'Tax', type: 'select', options: taxes.map(t => ({ v: t.id, l: `${t.name} ${t.rate}%` })), blank: 'No tax' },
    { name: 'sales_price', label: 'Sales price (₹)', type: 'number', required: true, min: 0 }, { name: 'cost_price', label: 'Cost price (₹)', type: 'number', min: 0 },
    p && { name: 'active', label: 'Active', type: 'check' }],
  onSubmit: async v => { await (p ? api('PUT', `/api/products/${p.id}`, v) : api('POST', '/api/products', v)); toast('Product saved'); S.lookups = await api('GET', '/api/lookups'); renderView(); } });
}
function editVariant(p, v) {
  formModal({ title: v ? 'Edit variant' : `New variant · ${p.name}`, values: v || { attribute: 'Lens kit' }, fields: [
    { name: 'attribute', label: 'Attribute', required: true }, { name: 'value', label: 'Value', required: true },
    { name: 'extra_price', label: 'Extra price (₹)', type: 'number', min: 0 }, v && { name: 'active', label: 'Active', type: 'check' }],
  onSubmit: async x => { await (v ? api('PUT', `/api/variants/${v.id}`, x) : api('POST', `/api/products/${p.id}/variants`, x)); toast('Variant saved'); S.lookups = await api('GET', '/api/lookups'); renderView(); } });
}

VIEWS.plans = async () => {
  const plans = await api('GET', '/api/plans');
  if (isCustomer()) {
    const deals = await loadFlash();
    const dealFor = p => deals.find(d => d.product_id === p.product_id && (d.plan_id === p.id || p.period === 'month'));
    const cats = PRODUCT_TYPES.filter(t => plans.some(p => p.product_type === t));
    const cat = S.shopCat || '';
    const shown = plans.filter(p => !cat || p.product_type === cat).sort((a, b) => (dealFor(b) ? 1 : 0) - (dealFor(a) ? 1 : 0));
    return pageHead('Rent gear', 'Pick a rental plan; our team confirms it and your gear ships. Prices exclude 18% GST.',
      deals.length ? `<button class="btn primary" type="button" ${act(() => openDeck(deals))}>${icon('zap')}${deals.length} flash deals</button>` : '') + `
      <div class="chips" role="group" aria-label="Filter by category">${['', ...cats].map(c => `<button type="button" class="chip ${c === cat ? 'on' : ''}" aria-pressed="${c === cat}" ${act(() => { S.shopCat = c; renderView(); })}>${c ? icon(typeIcon(c)) : ''}${esc(c || 'All gear')}</button>`).join('')}</div>
      <div class="plan-cards">${shown.map(p => {
        const d = dealFor(p);
        const sale = d && (d.type === 'percent' ? p.price * (1 - d.value / 100) : Math.max(0, p.price - d.value));
        return `<article class="card plan-card ${d ? 'has-deal' : ''}" style="margin:0">
        <div class="art">${productImg(p.product_id, p.image_rev, p.product)}${d ? `<span class="ribbon">${icon('zap')}${d.type === 'percent' ? '−' + d.value + '%' : '−' + inr0(d.value)}</span>` : ''}</div>
        <span class="muted mono" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">${esc(p.product_type)} · ${esc(p.product)}</span>
        <h3 style="margin:2px 0 0">${esc(p.name)}</h3>
        <div class="price">${d ? `<s class="was">${inr0(p.price)}</s> ${inr0(sale)}` : inr0(p.price)} <small>/ ${p.period === 'year' ? 'unit / year' : 'month'}</small></div>
        <div class="spec">${p.min_qty > 1 ? `<span>min ${p.min_qty}</span>` : ''}${p.pausable ? '<span>pausable</span>' : ''}${p.closable ? '<span>return anytime</span>' : ''}${p.renewable ? '<span>auto-renews</span>' : ''}${p.variants.length ? `<span>${p.variants.length} kit option${p.variants.length > 1 ? 's' : ''}</span>` : ''}</div>
        <button class="btn primary" type="button" style="margin-top:auto;justify-content:center" ${act(() => subscribe(p, d ? { discount_code: d.code } : {}))}>${d ? 'Rent at flash price' : 'Rent now'}</button></article>`;
      }).join('')}</div>`;
  }
  const full = can('plans', 'full');
  return pageHead('Rental plans', 'Once a plan has active rentals its price is locked; changing it creates a new version so existing customers keep their price.',
    full ? `<button class="btn primary" type="button" ${act(() => editPlan(null))}>${icon('plus')}New plan</button>` : `<button class="btn" type="button" ${act(() => newRequest({ type: 'plan' }))}>Request plan change</button>`) + `
    <div class="card flush">${table([
    { h: 'Plan', v: p => `<b>${esc(p.name)}</b> <span class="badge">v${p.version}</span>` }, { h: 'Product', v: p => esc(p.product) },
    { h: 'Price', num: 1, v: p => `${inr(p.price)}<span class="muted"> / ${p.period}</span>` }, { h: 'Min qty', num: 1, v: p => p.min_qty },
    { h: 'Rules', v: p => `<div class="spec" style="margin:0">${p.pausable ? '<span>pausable</span>' : ''}${p.closable ? '<span>closable</span>' : ''}${p.renewable ? '<span>renewable</span>' : ''}${p.auto_close ? '<span>auto-close</span>' : ''}${p.term_periods ? `<span>term ${p.term_periods} ${p.period}</span>` : ''}</div>` },
    { h: 'Subscribers', num: 1, v: p => p.subscribers }, { h: 'Status', v: p => `${p.active ? badge('active') : '<span class="badge">archived</span>'} ${p.locked ? '<span class="badge warn" title="Price locked by active subscriptions">locked</span>' : ''}` },
    { h: '', v: p => (full ? `<button class="btn sm" type="button" ${act(() => editPlan(p))}>Edit</button>` : '') }], plans)}</div>`;
};
function planFields(withProduct) {
  return [{ name: 'name', label: 'Plan name', required: true, full: true },
    withProduct && { name: 'product_id', label: 'Product', type: 'select', options: (S.lookups.products || []).map(p => ({ v: p.id, l: p.name })), required: true },
    { name: 'price', label: 'Price (₹)', type: 'number', required: true, min: 0 }, { name: 'period', label: 'Billing period', type: 'select', options: [{ v: 'month', l: 'Monthly' }, { v: 'year', l: 'Yearly' }] },
    { name: 'min_qty', label: 'Minimum quantity', type: 'number', min: 1 }, { name: 'term_periods', label: 'Term length (periods, blank = open-ended)', type: 'number', min: 1 },
    { name: 'pausable', label: 'Pausable', type: 'check' }, { name: 'closable', label: 'Closable early', type: 'check' }, { name: 'renewable', label: 'Renewable at end date', type: 'check' }, { name: 'auto_close', label: 'Auto-close at end date', type: 'check' }];
}
function editPlan(p) {
  formModal({ title: p ? `Edit ${p.name} v${p.version}` : 'New plan', values: p || { period: 'month', min_qty: 1, closable: true }, fields: [...planFields(!p), p && { name: 'active', label: 'Available for new subscriptions', type: 'check' }],
    intro: p && p.locked ? `<div class="ok-box" style="background:var(--warn-weak);color:var(--warn)">${p.subscribers} active subscription(s) use this plan, so a price or period change will be saved as version ${p.version + 1}.</div>` : '',
    onSubmit: async v => {
      if (p) {
        const priceChange = Number(v.price) !== p.price || v.period !== p.period;
        const r = await api('PUT', `/api/plans/${p.id}`, { ...v, new_version: p.locked && priceChange });
        toast(r.versioned ? `Saved as a new version; existing subscribers keep ${inr(p.price)}` : 'Plan saved');
      } else { await api('POST', '/api/plans', v); toast('Plan created'); }
      S.lookups = await api('GET', '/api/lookups'); renderView();
    } });
}
// Rental checkout with kit option, discount code and a live estimate (the server re-prices everything).
function subscribe(p, preset = {}) {
  const per = p.period === 'year' ? 'year' : 'month';
  formModal({ title: `Rent · ${p.name}`, submit: 'Request rental', wide: true, values: { quantity: p.min_qty, start_date: S.me.today, variant_id: '', discount_code: '', ...preset }, fields: v => {
    const variant = p.variants.find(x => String(x.id) === String(v.variant_id));
    const qty = Math.max(Number(v.quantity) || p.min_qty, 1);
    const sub = (p.price + (variant ? variant.extra_price : 0)) * qty;
    const deal = (S.flash || []).find(d => d.code === String(v.discount_code || '').trim().toUpperCase() && d.product_id === p.product_id);
    const off = deal ? (deal.type === 'percent' ? sub * deal.value / 100 : Math.min(deal.value, sub)) : 0;
    const taxable = sub - off, gst = taxable * 0.18;
    return [
      p.variants.length && { name: 'variant_id', label: 'Kit option', type: 'select', options: p.variants.map(x => ({ v: x.id, l: `${x.attribute}: ${x.value} (+${inr0(x.extra_price)})` })), blank: 'Standard', rerender: true, full: true },
      { name: 'quantity', label: p.period === 'year' ? 'Units' : 'Quantity', type: 'number', min: p.min_qty, required: true, rerender: true },
      { name: 'start_date', label: 'Start date', type: 'date', required: true },
      { name: 'discount_code', label: 'Discount / flash code', rerender: true, full: true },
      { type: 'static', name: '_sum', html: `<div class="estimate"><div class="row" style="justify-content:space-between"><span>${qty} × ${esc(p.name)}${variant ? ` + ${esc(variant.value)}` : ''}</span><span class="mono">${inr(sub)}</span></div>
        ${deal ? `<div class="row" style="justify-content:space-between;color:var(--ok)"><span>${icon('zap')} ${esc(deal.code)} flash discount</span><span class="mono">−${inr(off)}</span></div>` : v.discount_code ? '<div class="muted" style="font-size:12px">Code will be checked when you submit.</div>' : ''}
        <div class="row" style="justify-content:space-between" ><span class="muted">GST 18%</span><span class="mono">${inr(gst)}</span></div>
        <div class="row total" style="justify-content:space-between"><b>Every ${per}</b><b class="mono">${inr(taxable + gst)}</b></div>
        <div class="muted" style="font-size:12px">Your rental starts as a draft until our team confirms it and ships the gear.</div></div>` },
    ];
  }, onSubmit: async v => {
    const s = await api('POST', '/api/portal/subscribe', { plan_id: p.id, quantity: v.quantity, start_date: v.start_date, variant_id: v.variant_id || null, discount_code: v.discount_code || null });
    toast(`${s.number} requested — we'll confirm it shortly`); location.hash = '#/subscriptions';
  } });
}

// ---------- flash sale card deck ----------
async function loadFlash() { try { S.flash = await api('GET', '/api/flash-sales'); } catch (e) { S.flash = []; } return S.flash; }
const deckRoot = () => document.getElementById('deck-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'deck-root' }));
const DECK = { deals: [], i: 0, timer: null, open: false, returnFocus: null };
function clearDeck() { clearInterval(DECK.timer); DECK.open = false; deckRoot().innerHTML = ''; }
function openDeck(deals, start = 0) {
  if (!deals || !deals.length) { toast('No flash sales are live right now'); return; }
  clearDeck();
  Object.assign(DECK, { deals, i: Math.min(start, deals.length - 1), open: true, returnFocus: document.activeElement });
  const n = deals.length;
  const staffCta = !isCustomer() && can('discounts', 'full');
  deckRoot().innerHTML = `<div class="deck-overlay"><div class="deck-wrap" role="dialog" aria-modal="true" aria-labelledby="deck-title">
    <div class="deck-head"><span class="flash-tag" id="deck-title">${icon('zap')}Flash sale</span><span class="deck-count mono" aria-live="polite"></span>
      <button class="iconbtn deck-close" type="button" aria-label="Tuck away flash sales" title="Tuck away (Esc)">${icon('down')}</button></div>
    <div class="deck">${deals.map((d, k) => `<article class="deal" data-k="${k}" aria-roledescription="slide" aria-label="Deal ${k + 1} of ${n}: ${esc(d.product)}">
      <div class="deal-art">${productImg(d.product_id, d.image_rev, d.product)}<span class="deal-off">${d.type === 'percent' ? '−' + d.value + '%' : '−' + inr0(d.value)}</span></div>
      <div class="deal-body"><div class="deal-eyebrow">${esc(d.product_type)} · ${esc(d.product)}</div>
        <h2 class="deal-title">${esc(d.headline || d.product)}</h2>
        <div class="deal-price"><s>${inr0(d.price)}</s><b>${inr(d.sale_price)}</b><small>/ ${d.period === 'year' ? 'year' : 'month'}</small></div>
        <div class="spec"><span>code ${esc(d.code)}</span><span>${esc(d.plan_name)}</span>${d.left != null ? `<span>${d.left} left</span>` : ''}</div>
        <div class="deal-foot"><div class="cd" data-end="${esc(d.end_date)}"><span class="muted">Ends in</span> <b class="mono">—</b></div>
          ${isCustomer() ? `<button class="btn primary deal-cta" type="button" data-k="${k}">Rent now ${icon('right')}</button>` : staffCta ? `<button class="btn deal-cta" type="button" data-k="${k}">Edit sale</button>` : ''}</div></div></article>`).join('')}</div>
    <div class="deck-nav"><button class="iconbtn deck-prev" type="button" aria-label="Previous deal">${icon('left')}</button>
      <div class="dots">${deals.map((d, k) => `<button type="button" class="dot" data-k="${k}" aria-label="Go to deal ${k + 1}"></button>`).join('')}</div>
      <button class="iconbtn deck-next" type="button" aria-label="Next deal">${icon('right')}</button></div>
    <div class="deck-hint">← → to browse · Esc to tuck away</div></div></div>`;
  const root = deckRoot();
  root.querySelector('.deck-overlay').addEventListener('mousedown', e => { if (e.target.classList.contains('deck-overlay')) minimizeDeck(); });
  root.querySelector('.deck-close').onclick = minimizeDeck;
  root.querySelector('.deck-prev').onclick = () => stepDeck(-1);
  root.querySelector('.deck-next').onclick = () => stepDeck(1);
  root.querySelectorAll('.dot').forEach(b => { b.onclick = () => { DECK.i = Number(b.dataset.k); layoutDeck(); }; });
  // Clicking a peeking card behind the top one brings it forward.
  root.querySelectorAll('.deal').forEach(c => c.addEventListener('click', e => { if (!c.classList.contains('is-top') && !e.target.closest('button')) { DECK.i = Number(c.dataset.k); layoutDeck(); } }));
  root.querySelectorAll('.deal-cta').forEach(b => { b.onclick = () => dealAction(DECK.deals[Number(b.dataset.k)]); });
  layoutDeck();
  tickDeck(); DECK.timer = setInterval(tickDeck, 1000);
  root.querySelector('.deck-next').focus();
}
function stepDeck(dir) { const n = DECK.deals.length; DECK.i = (DECK.i + dir + n) % n; layoutDeck(); }
function layoutDeck() {
  const root = deckRoot(), n = DECK.deals.length;
  root.querySelectorAll('.deal').forEach(c => {
    const off = (Number(c.dataset.k) - DECK.i + n) % n;
    c.className = 'deal is-' + (off === 0 ? 'top' : off === 1 ? 'b1' : off === 2 ? 'b2' : n > 2 && off === n - 1 ? 'gone' : 'hidden');
    c.inert = off !== 0;
  });
  root.querySelectorAll('.dot').forEach(d => { const on = Number(d.dataset.k) === DECK.i; d.classList.toggle('on', on); d.setAttribute('aria-current', on ? 'true' : 'false'); });
  root.querySelector('.deck-count').textContent = `${DECK.i + 1} / ${n}`;
}
function tickDeck() {
  // Countdown runs against the business date plus the real time of day.
  const now = new Date();
  const msToday = now.getHours() * 3600e3 + now.getMinutes() * 60e3 + now.getSeconds() * 1e3;
  deckRoot().querySelectorAll('.cd').forEach(el => {
    const left = Date.parse(el.dataset.end + 'T23:59:59') - Date.parse(S.me.today + 'T00:00:00') - msToday;
    const b = el.querySelector('b');
    if (left <= 0) { b.textContent = 'ending now'; return; }
    const d = Math.floor(left / 86400e3), h = Math.floor(left / 3600e3) % 24, m = Math.floor(left / 60e3) % 60, s = Math.floor(left / 1e3) % 60;
    b.textContent = `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  });
}
function minimizeDeck() {
  const deals = DECK.deals, i = DECK.i, back = DECK.returnFocus;
  clearDeck();
  deckRoot().innerHTML = `<button class="flash-pill" type="button" aria-label="Open ${deals.length} flash deals">${icon('zap')}<span>${deals.length} flash deals</span>${icon('right')}</button>`;
  deckRoot().querySelector('.flash-pill').onclick = () => openDeck(deals, i);
  if (back && back.isConnected) back.focus();
}
async function dealAction(d) {
  if (isCustomer()) {
    minimizeDeck();
    const plan = (await api('GET', '/api/plans')).find(p => p.id === d.plan_id);
    if (plan) subscribe(plan, { discount_code: d.code });
  } else {
    clearDeck();
    const full = (await api('GET', '/api/discounts')).find(x => x.id === d.id);
    if (full) editDiscount(full);
  }
}
async function maybeAutoDeck() {
  if (!isCustomer()) return;
  const deals = await loadFlash();
  if (!deals.length) return;
  let seen = false;
  try { seen = sessionStorage.getItem('bl_deck_seen') === '1'; sessionStorage.setItem('bl_deck_seen', '1'); } catch (e) { /* ignore */ }
  if (seen) { DECK.deals = deals; DECK.i = 0; minimizeDeck(); } else setTimeout(() => openDeck(deals), 350);
}

VIEWS.taxes = async () => {
  const taxes = await api('GET', '/api/taxes');
  const full = can('taxes', 'full');
  return pageHead('Taxes', 'Tax is applied after discounts, as GST requires.', full ? `<button class="btn primary" type="button" ${act(() => editTax(null))}>${icon('plus')}New tax</button>` : '') +
    `<div class="card flush">${table([{ h: 'Name', v: t => `<b>${esc(t.name)}</b>` }, { h: 'Rate', num: 1, v: t => `${t.rate}%` }, { h: 'Status', v: t => (t.active ? badge('active') : badge('inactive')) },
      { h: '', v: t => (full ? `<button class="btn sm" type="button" ${act(() => editTax(t))}>Edit</button>` : '') }], taxes)}</div>`;
};
function editTax(t) {
  formModal({ title: t ? `Edit ${t.name}` : 'New tax', values: t || {}, fields: [{ name: 'name', label: 'Name', required: true }, { name: 'rate', label: 'Rate (%)', type: 'number', required: true, min: 0 }, t && { name: 'active', label: 'Active', type: 'check' }],
    onSubmit: async v => { await (t ? api('PUT', `/api/taxes/${t.id}`, v) : api('POST', '/api/taxes', v)); toast('Tax saved'); renderView(); } });
}

VIEWS.discounts = async () => {
  const list = await api('GET', '/api/discounts');
  const full = can('discounts', 'full');
  return pageHead('Discounts & flash sales', 'A discount stops applying automatically once it passes its end date or reaches its usage limit. Flash sales also appear in the customers\' deal deck.',
    `<button class="btn" type="button" ${act(async () => openDeck(await loadFlash()))}>${icon('zap')}Preview flash deck</button>` +
    (full ? `<button class="btn primary" type="button" ${act(() => editDiscount(null))}>${icon('plus')}New discount</button>` : `<button class="btn primary" type="button" ${act(() => newRequest({ type: 'discount' }))}>Request a discount</button>`)) + `
    <div class="card flush">${table([
    { h: 'Code', v: d => `<span class="code">${esc(d.code)}</span>${d.flash ? ` <span class="badge accent">${icon('zap')}flash</span>` : ''}${d.headline ? `<div class="muted" style="font-size:12px">${esc(d.headline)}</div>` : ''}` }, { h: 'Value', num: 1, v: d => (d.type === 'percent' ? `${d.value}%` : inr(d.value)) },
    { h: 'Min qty', num: 1, v: d => d.min_qty }, { h: 'Valid', v: d => `${fdate(d.start_date)} – ${fdate(d.end_date)}` }, { h: 'Product', v: d => esc(d.product || 'Any') },
    { h: 'Usage', v: d => `<div class="row" style="flex-wrap:nowrap"><div class="bar" style="width:90px"><span style="width:${d.usage_limit ? Math.min(100, (d.usage_count / d.usage_limit) * 100) : 0}%"></span></div><span class="mono" style="font-size:12px">${d.usage_count}${d.usage_limit ? '/' + d.usage_limit : ''}</span></div>` },
    { h: 'Status', v: d => badge(d.status) }, { h: '', v: d => (full ? `<button class="btn sm" type="button" ${act(() => editDiscount(d))}>Edit</button>` : '') }], list, 'No discounts yet')}</div>`;
};
function editDiscount(d) {
  formModal({ title: d ? `Edit ${d.code}` : 'New discount', values: d || { type: 'percent', min_qty: 1 }, fields: [
    { name: 'code', label: 'Code', required: true }, { name: 'type', label: 'Type', type: 'select', options: [{ v: 'percent', l: 'Percent off' }, { v: 'fixed', l: 'Fixed amount (₹)' }] },
    { name: 'value', label: 'Value', type: 'number', required: true, min: 0 }, { name: 'min_qty', label: 'Minimum quantity', type: 'number', min: 1 },
    { name: 'start_date', label: 'Valid from', type: 'date' }, { name: 'end_date', label: 'Valid until', type: 'date' },
    { name: 'usage_limit', label: 'Usage limit', type: 'number', min: 1 }, { name: 'product_id', label: 'Applies to', type: 'select', options: (S.lookups.products || []).map(p => ({ v: p.id, l: p.name })), blank: 'Any product' },
    { name: 'flash', label: 'Show as a flash sale in the customer deal deck (needs one product and an end date)', type: 'check', full: true },
    { name: 'headline', label: 'Flash headline', full: true },
    d && { name: 'active', label: 'Active', type: 'check' }],
  onSubmit: async v => { await (d ? api('PUT', `/api/discounts/${d.id}`, v) : api('POST', '/api/discounts', v)); toast('Discount saved'); renderView(); } });
}

VIEWS.templates = async () => {
  const list = await api('GET', '/api/templates');
  const full = can('templates', 'full'), quote = can('subscriptions', 'edit');
  return pageHead('Quote templates', 'Start a quotation in one click; it expires automatically when its validity runs out.',
    full ? `<button class="btn primary" type="button" ${act(() => editTemplate(null))}>${icon('plus')}New template</button>` : '') + `
    <div class="card flush">${table([{ h: 'Template', v: t => `<b>${esc(t.name)}</b>` }, { h: 'Plan', v: t => esc(t.plan) + (t.plan_active ? '' : ' <span class="badge">archived plan</span>') }, { h: 'Variant', v: t => esc(t.variant || '—') },
      { h: 'Default qty', num: 1, v: t => t.default_qty }, { h: 'Valid for', num: 1, v: t => `${t.validity_days} days` }, { h: 'Status', v: t => (t.active ? badge('active') : badge('inactive')) },
      { h: '', v: t => `<div class="row">${quote && t.active ? `<button class="btn sm primary" type="button" ${act(() => quoteFromTemplate(t))}>Create quote</button>` : ''}${full ? `<button class="btn sm" type="button" ${act(() => editTemplate(t))}>Edit</button>` : ''}</div>` }], list)}</div>`;
};
function editTemplate(t) {
  const L = S.lookups;
  formModal({ title: t ? `Edit ${t.name}` : 'New quote template', values: t || { validity_days: 15, default_qty: 1 }, fields: v => {
    const plan = (L.plans || []).find(p => String(p.id) === String(v.plan_id));
    return [{ name: 'name', label: 'Name', required: true, full: true },
      { name: 'plan_id', label: 'Plan', type: 'select', options: (L.plans || []).filter(p => p.active || (t && p.id === t.plan_id)).map(p => ({ v: p.id, l: `${p.name} v${p.version}` })), required: true, rerender: true, blank: 'Choose…' },
      { name: 'variant_id', label: 'Variant', type: 'select', options: (L.variants || []).filter(x => plan && x.product_id === plan.product_id).map(x => ({ v: x.id, l: `${x.attribute}: ${x.value} (+${inr0(x.extra_price)})` })), blank: 'None' },
      { name: 'default_qty', label: 'Default quantity', type: 'number', min: 1 }, { name: 'validity_days', label: 'Valid for (days)', type: 'number', min: 1 }, t && { name: 'active', label: 'Active', type: 'check' }];
  }, onSubmit: async v => { await (t ? api('PUT', `/api/templates/${t.id}`, v) : api('POST', '/api/templates', v)); toast('Template saved'); renderView(); } });
}
function quoteFromTemplate(t) {
  formModal({ title: `Quote from ${t.name}`, submit: 'Create quote', values: { quantity: t.default_qty, start_date: S.me.today }, fields: [
    { name: 'customer_id', label: 'Customer', type: 'select', options: (S.lookups.customers || []).map(c => ({ v: c.id, l: c.name })), required: true, blank: 'Choose…', full: true },
    { name: 'quantity', label: 'Quantity', type: 'number', min: 1, required: true }, { name: 'start_date', label: 'Start date', type: 'date', required: true },
    { name: 'discount_code', label: 'Discount code', hint: 'Optional — must be live and meet its minimum quantity.' }],
  onSubmit: async v => { const s = await api('POST', `/api/templates/${t.id}/quote`, v); toast(`${s.number} created, valid until ${fdate(s.quote_valid_until)}`); location.hash = '#/subscriptions'; setTimeout(() => showSubscription(s.id), 150); } });
}

// --- subscriptions
VIEWS.subscriptions = async () => {
  const list = await api('GET', '/api/subscriptions');
  const f = S.subFilter || '';
  const rows = f ? list.filter(s => s.state === f) : list;
  const staffEdit = !isCustomer() && can('subscriptions', 'edit');
  wireView = () => { const s = $('#subfilter'); if (s) s.onchange = () => { S.subFilter = s.value; renderView(); }; };
  return pageHead(isCustomer() ? 'My rentals' : 'Rentals', isCustomer() ? 'Accept quotes, and request pauses, plan changes or returns.' : 'Drafts and quotes become active once confirmed; billing picks up active rentals on their next invoice date.',
    `<label class="row muted" for="subfilter" style="font-size:13px">State <select id="subfilter">${opts(['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed', 'expired', 'cancelled'].map(s => ({ v: s, l: s })), f, 'All')}</select></label>
    ${staffEdit ? `<button class="btn primary" type="button" ${act(newSubscription)}>${icon('plus')}New subscription</button>` : ''}`) + `
    <div class="card flush">${table([
    { h: 'Number', v: s => `<a href="#" class="code" ${act(() => showSubscription(s.id))}>${esc(s.number)}</a>` }, !isCustomer() && { h: 'Customer', v: s => esc(s.customer) },
    { h: 'Plan', v: s => `${esc(s.plan_name)}${s.variant ? `<div class="muted" style="font-size:12px">${esc(s.variant)}</div>` : ''}${s.pending_plan ? `<div style="font-size:12px;color:var(--warn)">→ ${esc(s.pending_plan)} next period</div>` : ''}` },
    { h: 'Qty', num: 1, v: s => s.quantity }, { h: 'State', v: s => badge(s.state) + (s.state === 'quotation' ? `<div class="muted" style="font-size:12px">until ${fdate(s.quote_valid_until)}</div>` : '') },
    { h: 'Next invoice', v: s => (['active', 'confirmed'].includes(s.state) ? fdate(s.next_invoice_date || s.start_date) : '—') },
    { h: 'Per period (incl. GST)', num: 1, v: s => `${inr(s.recurring_total)}<span class="muted">/${s.period === 'year' ? 'yr' : 'mo'}</span>` },
    { h: '', v: s => `<button class="btn sm" type="button" ${act(() => showSubscription(s.id))}>Open</button>` }].filter(Boolean), rows, isCustomer() ? 'No rentals yet — browse Rent gear to get started.' : 'No rentals')}</div>`;
};
function newSubscription() {
  const L = S.lookups;
  formModal({ title: 'New subscription', submit: 'Create', wide: true, values: { start_date: S.me.today, as_quote: false, quantity: 1 }, fields: v => {
    const plan = (L.plans || []).find(p => String(p.id) === String(v.plan_id));
    return [{ name: 'customer_id', label: 'Customer', type: 'select', options: (L.customers || []).map(c => ({ v: c.id, l: c.name })), required: true, blank: 'Choose…' },
      { name: 'plan_id', label: 'Plan', type: 'select', options: (L.plans || []).filter(p => p.active).map(p => ({ v: p.id, l: `${p.name} v${p.version} (min ${p.min_qty})` })), required: true, rerender: true, blank: 'Choose…' },
      { name: 'variant_id', label: 'Variant', type: 'select', options: (L.variants || []).filter(x => plan && x.product_id === plan.product_id).map(x => ({ v: x.id, l: `${x.attribute}: ${x.value} (+${inr0(x.extra_price)})` })), blank: 'None' },
      { name: 'quantity', label: 'Quantity', type: 'number', min: plan ? plan.min_qty : 1, required: true },
      { name: 'start_date', label: 'Start date', type: 'date', required: true }, { name: 'discount_code', label: 'Discount code' },
      { name: 'as_quote', label: 'Send as a quotation (customer accepts in the portal)', type: 'check', full: true }];
  }, onSubmit: async v => { const s = await api('POST', '/api/subscriptions', v); toast(`${s.number} created as ${s.state}`); renderView(); } });
}
async function showSubscription(id) {
  const s = await api('GET', `/api/subscriptions/${id}`);
  const staffEdit = !isCustomer() && can('subscriptions', 'edit');
  const full = can('subscriptions', 'full');
  const btns = [];
  const doPost = (url, msg, body) => async e => { await busy(e.currentTarget, async () => { await api('POST', url, body); toast(msg); closeModal(); renderView(); }); };
  if (isCustomer()) {
    if (s.state === 'quotation') btns.push(`<button class="btn primary" type="button" ${act(doPost(`/api/subscriptions/${s.id}/accept`, `Quote accepted — ${s.number} is confirmed`))}>${icon('check')}Accept quote</button>`);
    if (s.state === 'active' && s.pausable) btns.push(`<button class="btn" type="button" ${act(() => quickRequest('sub_pause', { subscription_id: s.id }, `Pause ${s.number}`, { text: 'While paused you won\'t be billed. Staff will review your request.' }))}>Request pause</button>`);
    if (s.state === 'paused') btns.push(`<button class="btn" type="button" ${act(() => quickRequest('sub_resume', { subscription_id: s.id }, `Resume ${s.number}`))}>Request resume</button>`);
    if (s.state === 'active') btns.push(`<button class="btn" type="button" ${act(() => { closeModal(); newRequest({ type: 'sub_upgrade', subscription_id: s.id }); })}>Change plan</button>`);
    if (['active', 'paused'].includes(s.state) && s.closable) btns.push(`<button class="btn danger" type="button" ${act(() => quickRequest('sub_close', { subscription_id: s.id }, `Cancel ${s.number}`, { text: 'Request to close this subscription early.', comment: { label: 'Reason (optional)' } }))}>Request cancellation</button>`);
  } else {
    if (staffEdit && s.state === 'draft') btns.push(`<button class="btn primary" type="button" ${act(doPost(`/api/subscriptions/${s.id}/confirm`, `${s.number} confirmed`))}>${icon('check')}Confirm</button>`);
    if (staffEdit && s.state === 'quotation') btns.push(`<button class="btn primary" type="button" ${act(doPost(`/api/subscriptions/${s.id}/accept`, `${s.number} marked as accepted`))}>${icon('check')}Customer accepted</button>`);
    if (staffEdit && ['draft', 'quotation'].includes(s.state)) btns.push(`<button class="btn" type="button" ${act(() => editSubscription(s))}>Edit</button>`);
    if (full) {
      if (s.state === 'active' && s.pausable) btns.push(`<button class="btn" type="button" ${act(doPost(`/api/subscriptions/${s.id}/state`, 'Paused', { state: 'paused' }))}>Pause</button>`);
      if (s.state === 'paused') btns.push(`<button class="btn" type="button" ${act(doPost(`/api/subscriptions/${s.id}/state`, 'Resumed', { state: 'active' }))}>Resume</button>`);
      if (['active', 'paused', 'confirmed'].includes(s.state) && s.closable) btns.push(`<button class="btn danger" type="button" ${act(doPost(`/api/subscriptions/${s.id}/state`, 'Closed', { state: 'closed' }))}>Close</button>`);
      if (['draft', 'quotation'].includes(s.state)) btns.push(`<button class="btn danger" type="button" ${act(doPost(`/api/subscriptions/${s.id}/state`, 'Cancelled', { state: 'cancelled' }))}>Cancel</button>`);
    } else if (can('requests', 'edit')) {
      if (s.state === 'active' && s.pausable) btns.push(`<button class="btn" type="button" ${act(() => quickRequest('sub_pause', { subscription_id: s.id }, `Pause ${s.number}`))}>Request pause</button>`);
      if (['active', 'paused'].includes(s.state) && s.closable) btns.push(`<button class="btn" type="button" ${act(() => quickRequest('sub_close', { subscription_id: s.id }, `Close ${s.number} early`, { comment: { label: 'Reason' } }))}>Request early close</button>`);
      if (['active', 'draft', 'quotation', 'confirmed'].includes(s.state)) btns.push(`<button class="btn" type="button" ${act(() => { closeModal(); newRequest({ type: 'custom_price', subscription_id: s.id, title: `Custom price for ${s.customer}` }); })}>Request custom price</button>`);
    }
  }
  openModal({ title: `${s.number} · ${s.customer}`, wide: true, footer: btns.join(''), html: `
    <div class="grid2"><dl class="kv"><dt>State</dt><dd>${badge(s.state)}</dd><dt>Plan</dt><dd>${esc(s.plan_name)} <span class="badge">v${s.plan_version}</span></dd>
      ${s.variant ? `<dt>Variant</dt><dd>${esc(s.variant)}</dd>` : ''}<dt>Quantity</dt><dd class="mono">${s.quantity}</dd>
      ${s.discount_code ? `<dt>Discount</dt><dd><span class="code">${esc(s.discount_code)}</span></dd>` : ''}${s.custom_price != null ? `<dt>Custom price</dt><dd class="mono">${inr(s.custom_price)}</dd>` : ''}
      ${s.pending_plan ? `<dt>Plan change</dt><dd>→ ${esc(s.pending_plan)} from next period</dd>` : ''}</dl>
    <dl class="kv"><dt>Start</dt><dd>${fdate(s.start_date)}</dd><dt>End of term</dt><dd>${fdate(s.end_date)}</dd>
      ${s.state === 'quotation' ? `<dt>Quote valid until</dt><dd>${fdate(s.quote_valid_until)}</dd>` : ''}<dt>Next invoice</dt><dd>${fdate(s.next_invoice_date)}</dd>
      ${s.salesperson ? `<dt>Salesperson</dt><dd>${esc(s.salesperson)}</dd>` : ''}<dt>MRR</dt><dd class="mono">${inr(s.mrr)}</dd></dl></div>
    <h3>Each ${s.period === 'year' ? 'year' : 'month'} (price preview)</h3>
    <table class="lines"><tbody>${s.preview.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('')}
      <tr><td>Taxable amount</td><td class="num">${inr(s.preview.taxable)}</td></tr><tr><td>GST</td><td class="num">${inr(s.preview.tax)}</td></tr>
      <tr class="total"><td>Total</td><td class="num">${inr(s.preview.total)}</td></tr></tbody></table>
    <h3>Invoices</h3>${table([{ h: 'Invoice', v: i => `<a href="#" ${act(() => showInvoice(i.id))}>${esc(i.number)}</a>` }, { h: 'Period', v: i => `${fdate(i.period_start)} – ${fdate(i.period_end)}` },
      { h: 'Total', num: 1, v: i => inr(i.total) }, { h: 'Balance', num: 1, v: i => inr(i.balance) }, { h: 'Status', v: i => badge(i.status) }], s.invoices, 'Not invoiced yet')}` });
}
function editSubscription(s) {
  formModal({ title: `Edit ${s.number}`, values: { quantity: s.quantity, start_date: s.start_date, discount_code: s.discount_code || '' }, fields: [
    { name: 'quantity', label: 'Quantity', type: 'number', min: 1, required: true }, { name: 'start_date', label: 'Start date', type: 'date', required: true },
    { name: 'discount_code', label: 'Discount code', full: true, hint: 'Leave blank to remove the discount.' }],
  onSubmit: async v => { await api('PUT', `/api/subscriptions/${s.id}`, v); toast('Saved'); renderView(); } });
}

// --- invoices
VIEWS.invoices = async () => {
  const list = await api('GET', '/api/invoices');
  const f = S.invFilter || '';
  const rows = f ? list.filter(i => i.status === f) : list;
  wireView = () => { const s = $('#invfilter'); if (s) s.onchange = () => { S.invFilter = s.value; renderView(); }; };
  return pageHead(isCustomer() ? 'My invoices' : 'Invoices', isCustomer() ? 'View and download your invoices.' : 'Billing creates draft invoices; confirm and send them so customers see them in the portal. Terms: Net 30.',
    `<label class="row muted" for="invfilter" style="font-size:13px">Status <select id="invfilter">${opts(['draft', 'confirmed', 'sent', 'overdue', 'paid', 'cancelled'].map(s => ({ v: s, l: s })), f, 'All')}</select></label>
    ${!isCustomer() && can('invoices', 'edit') ? `<button class="btn primary" type="button" ${act(e => runBilling(e.currentTarget))}>${icon('play')}Run billing</button>` : ''}`) + `
    <div class="card flush">${table([
    { h: 'Invoice', v: i => `<a href="#" class="code" ${act(() => showInvoice(i.id))}>${esc(i.number)}</a>` }, !isCustomer() && { h: 'Customer', v: i => esc(i.customer) },
    { h: 'Period', v: i => `<span style="font-size:13px">${fdate(i.period_start)} – ${fdate(i.period_end)}</span>` }, { h: 'Due', v: i => fdate(i.due_date) },
    { h: 'Total', num: 1, v: i => inr(i.total) }, { h: 'Balance', num: 1, v: i => inr(i.balance) }, { h: 'Status', v: i => badge(i.status) },
    { h: '', v: i => `<button class="btn sm" type="button" ${act(() => showInvoice(i.id))}>Open</button>` }].filter(Boolean), rows, 'No invoices')}</div>`;
};
function printInvoice(id) { window.open(`/api/invoices/${id}/print?token=${encodeURIComponent(S.token)}`, '_blank', 'width=900,height=1000'); }
async function showInvoice(id) {
  const i = await api('GET', `/api/invoices/${id}`);
  const staff = !isCustomer(), edit = staff && can('invoices', 'edit');
  const btns = [`<button class="btn" type="button" ${act(() => printInvoice(i.id))}>${icon('printer')}Print / PDF</button>`];
  const doPost = (url, msg) => async e => { await busy(e.currentTarget, async () => { await api('POST', url); toast(msg); closeModal(); renderView(); }); };
  if (edit && i.state === 'draft') btns.push(`<button class="btn primary" type="button" ${act(doPost(`/api/invoices/${i.id}/confirm`, `${i.number} confirmed`))}>Confirm</button>`);
  if (edit && i.state === 'confirmed') btns.push(`<button class="btn primary" type="button" ${act(doPost(`/api/invoices/${i.id}/send`, `${i.number} sent to customer`))}>Send to customer</button>`);
  if (staff && can('payments', 'edit') && ['confirmed', 'sent'].includes(i.state) && i.balance > 0) btns.push(`<button class="btn primary" type="button" ${act(() => recordPayment(i))}>${icon('payments')}Record payment</button>`);
  if (staff && can('requests', 'edit') && i.amount_paid > 0) btns.push(`<button class="btn" type="button" ${act(() => { closeModal(); newRequest({ type: 'refund', invoice_id: i.id, title: `Refund on ${i.number}` }); })}>Request refund</button>`);
  if (staff && can('invoices', 'full') && i.state !== 'cancelled' && i.state !== 'paid' && !i.amount_paid) btns.push(`<button class="btn danger" type="button" ${act(() => confirmModal(`Cancel ${i.number}?`, 'The invoice is voided and any discount usage it consumed is released.', async () => { await api('POST', `/api/invoices/${i.id}/cancel`); toast('Invoice cancelled'); renderView(); }, { danger: true, yes: 'Cancel invoice' }))}>Cancel invoice</button>`);
  const tax = i.lines.filter(l => /%$/.test(l.description)), items = i.lines.filter(l => !tax.includes(l));
  openModal({ title: `${i.number} · ${i.customer}`, wide: true, footer: btns.join(''), html: `
    <div class="grid2"><dl class="kv"><dt>Status</dt><dd>${badge(i.status)}</dd><dt>Subscription</dt><dd class="code">${esc(i.subscription)}</dd><dt>Period</dt><dd>${fdate(i.period_start)} – ${fdate(i.period_end)}</dd></dl>
    <dl class="kv"><dt>Issued</dt><dd>${fdate(i.issue_date)}</dd><dt>Due</dt><dd>${fdate(i.due_date)} <span class="muted">(Net 30)</span></dd><dt>Balance</dt><dd class="mono"><b>${inr(i.balance)}</b></dd></dl></div>
    <h3>Lines</h3><table class="lines"><tbody>${items.map(l => `<tr><td>${esc(l.description)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('')}
      <tr><td><b>Taxable amount</b></td><td class="num"><b>${inr(i.taxable)}</b></td></tr>${tax.map(l => `<tr><td>${esc(l.description)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${inr(i.total)}</td></tr>${i.amount_paid ? `<tr><td>Paid</td><td class="num">${inr(-i.amount_paid)}</td></tr>` : ''}</tbody></table>
    <h3>Payments</h3>${table([{ h: 'Date', v: p => fdate(p.date) }, { h: 'Method', v: p => esc(p.method) }, { h: 'Note', v: p => esc(p.note || '') }, staff && { h: 'Recorded by', v: p => esc(p.recorded_by_name || '') }, { h: 'Amount', num: 1, v: p => inr(p.amount) }].filter(Boolean), i.payments, 'No payments yet')}` });
}
function recordPayment(inv) {
  const invs = (S.lookups.invoices || []).filter(i => i.total - i.amount_paid > 0.004);
  formModal({ title: inv ? `Record payment · ${inv.number}` : 'Record payment', submit: 'Record payment', values: { invoice_id: inv?.id, amount: inv ? inv.balance : null, date: S.me.today, method: 'UPI' }, fields: [
    !inv && { name: 'invoice_id', label: 'Invoice', type: 'select', options: invs.map(i => ({ v: i.id, l: `${i.number} · due ${inr(i.total - i.amount_paid)}` })), required: true, blank: 'Choose…', full: true },
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0, hint: inv ? `Up to ${inr(inv.balance)} is owed. Payments can't exceed the balance.` : 'Payments can\'t exceed the balance owed.' },
    { name: 'method', label: 'Method', type: 'select', options: ['UPI', 'Bank transfer', 'Card', 'Cheque', 'Cash'].map(x => ({ v: x, l: x })) },
    { name: 'date', label: 'Payment date', type: 'date', required: true }, { name: 'note', label: 'Note / reference', full: true }],
  onSubmit: async v => { await api('POST', '/api/payments', { ...v, invoice_id: inv ? inv.id : Number(v.invoice_id) }); toast('Payment recorded'); S.lookups = await api('GET', '/api/lookups'); renderView(); } });
}

VIEWS.payments = async () => {
  const list = await api('GET', '/api/payments');
  const edit = !isCustomer() && can('payments', 'edit');
  const total = list.reduce((a, p) => a + p.amount, 0);
  return pageHead(isCustomer() ? 'Payment history' : 'Payments', isCustomer() ? '' : 'A payment can\'t exceed what is still owed, and can\'t be recorded against a cancelled invoice. Refunds go through an approved request.',
    `${edit ? `<button class="btn primary" type="button" ${act(() => recordPayment(null))}>${icon('plus')}Record payment</button>` : ''}${!isCustomer() && can('requests', 'edit') ? `<button class="btn" type="button" ${act(() => newRequest({ type: 'refund' }))}>Request refund</button>` : ''}`) + `
    <div class="tiles"><div class="tile"><div class="k">Payments</div><div class="v">${list.filter(p => p.amount > 0).length}</div></div><div class="tile"><div class="k">Net received</div><div class="v">${inr(total)}</div></div></div>
    <div class="card flush">${table([{ h: 'Date', v: p => fdate(p.date) }, { h: 'Invoice', v: p => `<a href="#" class="code" ${act(() => showInvoice(p.invoice_id))}>${esc(p.invoice)}</a>` },
      !isCustomer() && { h: 'Customer', v: p => esc(p.customer) }, { h: 'Method', v: p => (p.method === 'refund' ? '<span class="badge warn">refund</span>' : esc(p.method)) },
      { h: 'Note', v: p => `<span class="muted">${esc(p.note || '')}</span>` }, !isCustomer() && { h: 'Recorded by', v: p => esc(p.recorded_by_name || '') }, { h: 'Amount', num: 1, v: p => inr(p.amount) }].filter(Boolean), list, 'No payments yet')}</div>`;
};

// --- requests
VIEWS.requests = async () => {
  const list = await api('GET', '/api/requests');
  const f = S.reqFilter || '';
  const rows = f ? list.filter(r => r.status === f) : list;
  wireView = () => { const s = $('#reqfilter'); if (s) s.onchange = () => { S.reqFilter = s.value; renderView(); }; };
  const summary = r => {
    const p = r.payload, ref = r.refs || {};
    const sub = `<span class="code">${esc(ref.subscription || '#' + p.subscription_id)}</span>`;
    switch (r.type) {
      case 'discount': return `<span class="code">${esc(p.code)}</span> ${p.type === 'percent' ? p.value + '%' : inr(p.value)} off${p.min_qty > 1 ? `, min ${p.min_qty}` : ''}${p.end_date ? `, until ${fdate(p.end_date)}` : ''}${p.usage_limit ? `, ${p.usage_limit} uses` : ''}${ref.product ? ` · ${esc(ref.product)}` : ''}`;
      case 'custom_price': return `Unit price ${inr(p.price)} on ${sub}`;
      case 'plan': return `${esc(p.name)} — ${inr(p.price)}/${esc(p.period || 'month')}${p.plan_id ? ` (new version of ${esc(ref.plan)})` : ''}`;
      case 'product': return p.product_id ? `Variant ${esc(p.attribute)}: ${esc(p.value)} +${inr(p.extra_price || 0)} on ${esc(ref.product)}` : `Product ${esc(p.name)}`;
      case 'refund': return `${inr(p.amount)} on <span class="code">${esc(ref.invoice || '#' + p.invoice_id)}</span>${p.reason ? ' — ' + esc(p.reason) : ''}`;
      case 'sub_upgrade': return `${sub} → ${esc(ref.plan || '')}`;
      default: return sub;
    }
  };
  return pageHead(isCustomer() ? 'My requests' : 'Requests', 'Draft → Submitted → Approved / Rejected (with a reason) → Applied. Approval creates the real record automatically.',
    `<label class="row muted" for="reqfilter" style="font-size:13px">Status <select id="reqfilter">${opts(['draft', 'submitted', 'approved', 'rejected', 'applied'].map(s => ({ v: s, l: s })), f, 'All')}</select></label>
    ${can('requests', 'edit') ? `<button class="btn primary" type="button" ${act(() => newRequest())}>${icon('plus')}New request</button>` : ''}`) + `
    <div class="card flush">${table([{ h: '#', v: r => `<span class="mono">${r.id}</span>` }, { h: 'Request', v: r => `<b>${esc(r.title || r.type_label)}</b><div class="muted" style="font-size:12px">${esc(r.type_label)}</div>` },
      { h: 'Details', v: r => `<span style="font-size:13px">${summary(r)}</span>` }, !isCustomer() && { h: 'Raised by', v: r => `${esc(r.raised_by_name)}${r.raised_by_role === 'customer' ? ' <span class="badge">customer</span>' : ''}` },
      { h: 'Status', v: r => badge(r.status) }, { h: 'Outcome', v: r => `<span style="font-size:13px">${esc(r.result || r.comment || '')}</span>${r.decided_by_name ? `<div class="muted" style="font-size:12px">by ${esc(r.decided_by_name)}</div>` : ''}` },
      { h: '', v: r => `<div class="row">${r.can_decide ? `<button class="btn sm primary" type="button" ${act(() => decide(r, true))}>Approve</button><button class="btn sm danger" type="button" ${act(() => decide(r, false))}>Reject</button>` : ''}
        ${r.raised_by === S.me.user.id && ['draft', 'rejected'].includes(r.status) ? `<button class="btn sm" type="button" ${act(async e => busy(e.currentTarget, async () => { await api('POST', `/api/requests/${r.id}/submit`); toast('Resubmitted'); renderView(); }))}>${r.status === 'rejected' ? 'Resubmit' : 'Submit'}</button>` : ''}</div>` }].filter(Boolean), rows, 'No requests')}</div>`;
};
function decide(r, approve) {
  confirmModal(`${approve ? 'Approve' : 'Reject'} request #${r.id}`, `${esc(r.title || r.type_label)} — raised by ${esc(r.raised_by_name)}.${approve ? ' The record will be created automatically.' : ' It goes back to them with your reason.'}`,
    async v => { const out = await api('POST', `/api/requests/${r.id}/${approve ? 'approve' : 'reject'}`, { comment: v.comment }); toast(approve ? `Approved — ${out.result}` : 'Rejected; the requester was notified'); refresh(); },
    { yes: approve ? 'Approve & apply' : 'Reject', danger: !approve, comment: { label: approve ? 'Comment (optional)' : 'Reason', required: !approve } });
}

// --- reports
VIEWS.reports = async () => {
  const r = await api('GET', '/api/reports');
  const maxInv = Math.max(1, ...r.revenue_by_plan.map(p => p.invoiced));
  return pageHead('Reports', `As of ${fdate(r.today)}.`) + `
    <div class="tiles">${Object.entries(r.ageing).map(([k, b]) => `<div class="tile ${k === '60+' && b.amount ? 'bad' : ''}"><div class="k">Unpaid ${k} days</div><div class="v">${inr(b.amount)}</div><div class="s">${b.count} invoice(s)</div></div>`).join('')}</div>
    <div class="card flush"><h2>Revenue by plan</h2>${table([{ h: 'Plan', v: p => esc(p.plan) }, { h: 'Invoices', num: 1, v: p => p.invoices },
      { h: 'Invoiced', v: p => `<div class="row" style="flex-wrap:nowrap"><div class="bar" style="width:120px"><span style="width:${(p.invoiced / maxInv) * 100}%"></span></div><span class="mono" style="font-size:13px">${inr(p.invoiced)}</span></div>` },
      { h: 'Taxable', num: 1, v: p => inr(p.taxable) }, { h: 'GST', num: 1, v: p => inr(p.tax) }, { h: 'Collected', num: 1, v: p => inr(p.collected) }, { h: 'Outstanding', num: 1, v: p => inr(p.outstanding) }], r.revenue_by_plan)}</div>
    <div class="grid2"><div class="card flush"><h2>Discount usage</h2>${table([{ h: 'Code', v: d => `<span class="code">${esc(d.code)}</span>` }, { h: 'Used', num: 1, v: d => `${d.usage_count}${d.usage_limit ? '/' + d.usage_limit : ''}` },
      { h: 'Given away', num: 1, v: d => inr(d.total_discount) }, { h: 'Status', v: d => badge(d.status) }], r.discount_usage, 'No discounts')}</div>
    <div class="card flush"><h2>Ageing of unpaid invoices</h2>${table([{ h: 'Invoice', v: i => `<a href="#" class="code" ${act(() => showInvoice(i.id))}>${esc(i.number)}</a>` }, { h: 'Customer', v: i => esc(i.customer) },
      { h: 'Age', num: 1, v: i => `${i.age}d` }, { h: 'Bucket', v: i => `<span class="badge ${i.overdue ? 'bad' : ''}">${esc(i.bucket)}${i.overdue ? ' · overdue' : ''}</span>` }, { h: 'Balance', num: 1, v: i => inr(i.balance) }], r.unpaid, 'Everything is paid')}</div></div>`;
};

// ---------- boot ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = S.actions[el.dataset.a];
  // The listener sits on document, so hand handlers the clicked element as currentTarget.
  if (fn) { e.preventDefault(); fn({ currentTarget: el, target: e.target, event: e }); }
});
document.addEventListener('keydown', e => {
  if (DECK.open) {
    if (e.key === 'Escape') { e.preventDefault(); minimizeDeck(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepDeck(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepDeck(1); }
    return;
  }
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});
window.addEventListener('hashchange', () => { if (S.me) renderShell(); });

(async () => {
  if (S.token) {
    try { await loadMe(); renderShell(); maybeAutoDeck(); return; } catch (e) { S.token = null; }
  }
  renderAuth('login');
})();
