// LensUS walkthrough video: narrated (Windows TTS), captioned, recorded from the real app.
// Windows only (uses the built-in SAPI voices). Setup once: cd tools/video && npm install
// Run from the repo root: npx electron tools/video/make-video.js  ->  dist/video/LensUS-walkthrough.mp4 (+ .srt)
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync, spawn } = require('child_process');
const { app, BrowserWindow } = require('electron');
const { start } = require('../../server/app');
const FFMPEG = require('ffmpeg-static');

const WORK = path.join(__dirname, 'work');
const OUT_DIR = path.join(__dirname, '..', '..', 'dist', 'video');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_MP4 = path.join(OUT_DIR, 'LensUS-walkthrough.mp4');
const OUT_SRT = path.join(OUT_DIR, 'LensUS-walkthrough.srt');
const W = 1600, H = 900, FPS = 25;
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- story
let D; // page driver, set once the window exists
const S = (say, act, cap) => ({ say, act, cap: cap || say });
const STORY = [
  { n: 'Welcome', t: 'LensUS', s: 'Camera & accessories rentals', steps: [
    S('Welcome to LensUS, a rental desk for professional cameras and accessories.', () => D.hover('.auth .hero h1')),
    S('It runs as a single Windows app. The server, the database and the screens are all inside, so it works completely offline.', () => D.hover('.auth .stats')),
    S("In this walkthrough we'll follow one month at the rental desk, from a customer's first rental to billing, payments and reports.", () => D.hover('.demo')),
  ] },
  { n: 'Chapter 1', t: 'A customer signs up', s: 'Self-service accounts', steps: [
    S('A new customer, Kochi Bakes, creates an account from the sign-in screen.', () => D.click({ text: 'Create a customer account' })),
    S('The email must be unique, and the password must be strong, with upper and lower case letters, a digit and a symbol.', async () => {
      await D.type('#company', 'Kochi Bakes'); await D.type('#name', 'Asha Menon'); await D.type('#email', 'hello@kochibakes.in');
      await D.type('#phone', '+91 98470 12345'); await D.type('#password', 'Bakes@2026');
    }),
    S('Once the account is created, the customer is signed in straight away.', () => D.click({ text: 'Create account' })),
  ] },
  { n: 'Chapter 2', t: 'Flash sales', s: 'A stacked deck of live deals', steps: [
    S("Right after signing in, this week's flash sales pop up as a stacked card deck.", () => sleep(1500)),
    S('Each card shows the product, the deal, the new monthly price, the code, how many are left, and a live countdown.', async () => {
      await D.hover('.deal.is-top .deal-price'); await sleep(900); await D.hover('.deal.is-top .spec'); await sleep(900); await D.hover('.deal.is-top .cd');
    }),
    S('The arrows flip to the next card, and the dots show where you are.', async () => {
      await D.click({ sel: '.deck-next' }); await sleep(900); await D.click({ sel: '.deck-next' }); await sleep(900); await D.click({ sel: '.dot' });
    }),
    S('The keyboard arrows work too.', async () => { await key('Right'); await sleep(700); await key('Right'); await sleep(700); await key('Left'); }),
    S('The down arrow tucks the deck away into a flash deals pill, which reopens it at any time.', async () => { await D.click({ sel: '.deck-close' }); await sleep(600); await D.hover('.flash-pill'); }),
  ] },
  { n: 'Chapter 3', t: 'Renting gear', s: 'Catalogue, filters and checkout', steps: [
    S('The Rent gear page lists every rental plan with product images, from cinema cameras and drones to lights and microphones.', async () => {
      await D.click({ sel: '.nav button', text: 'Rent gear' }); await sleep(900); await D.scroll(700); await sleep(1200); await D.scroll(0);
    }),
    S('Customers can filter by category. Gear on flash sale carries a ribbon and the reduced price.', async () => {
      await D.click({ sel: '.chip', text: 'Drone' }); await sleep(1100); await D.click({ sel: '.chip', text: 'Lighting' }); await sleep(1100); await D.click({ sel: '.chip', text: 'All gear' });
    }),
    S('Kochi Bakes picks the Creator Kit, at nine hundred and ninety-nine rupees a month.', () => D.clickIn('.plan-card', 'Creator Kit Monthly', 'Rent now'),
      'Kochi Bakes picks the Creator Kit at ₹999 a month.'),
    S('Checkout shows a live estimate, including eighteen percent G.S.T., before anything is submitted.', async () => { await D.val('start_date', '2026-11-01'); await D.hover('.estimate'); },
      'Checkout shows a live estimate, including 18% GST, before anything is submitted.'),
    S('The rental starts as a draft, until the rental desk confirms it.', () => D.click({ sel: '#modal-root [data-submit]' })),
  ] },
  { n: 'Chapter 4', t: 'Staff & requests', s: 'Role-based access and approvals', steps: [
    S('Now Rahul from the sales team signs in. Staff only see the tabs their access allows, and the server checks every action again.', () => D.login('Rahul')),
    S('Rahul confirms the Kochi Bakes rental.', async () => {
      await D.click({ sel: '.nav button', text: 'Rentals' }); await sleep(800); await D.clickIn('tr', 'Kochi Bakes', 'Open'); await sleep(900); await D.click({ within: '#modal-root', text: 'Confirm' });
    }),
    S("Malabar Logistics wants twenty-five cameras with a volume discount. Staff can't create discounts, so Rahul raises a request.", async () => {
      await D.click({ sel: '.nav button', text: 'Requests' }); await sleep(800); await D.click({ text: 'New request' });
    }, "Malabar Logistics wants 25 cameras with a volume discount. Staff can't create discounts, so Rahul raises a request."),
    S('He asks for ten percent off twenty or more cameras, valid until the end of December, with up to fifty uses.', async () => {
      await D.type('[name=title]', 'Volume discount for Malabar'); await D.type('[name=code]', 'VOLUME10'); await D.type('[name=value]', '10');
      await D.type('[name=min_qty]', '20'); await D.val('start_date', '2026-11-01'); await D.val('end_date', '2026-12-31');
      await D.type('[name=usage_limit]', '50'); await D.select('product_id', 'Lumen X1');
    }, 'He asks for 10% off 20+ cameras, valid until 31 December, with up to 50 uses.'),
    S('The request goes to the admin for a decision.', () => D.click({ sel: '#modal-root [data-submit]' })),
  ] },
  { n: 'Chapter 5', t: 'Admin approval', s: 'Approved requests create real records', steps: [
    S('Anita, the admin, signs in and reviews the request.', async () => { await D.login('Anita'); await D.click({ sel: '.nav button', text: 'Requests' }); }),
    S('When she approves it, the discount is created automatically from the request. Nobody retypes anything.', async () => {
      await D.clickIn('tr', 'Volume discount', 'Approve'); await sleep(700); await D.type('[name=comment]', 'OK for 25 cameras'); await D.click({ sel: '#modal-root [data-submit]' });
    }),
    S('VOLUME10 is now live, next to the flash sales.', async () => { await D.click({ sel: '.nav button', text: 'Discounts' }); await sleep(900); await D.hover('tbody tr:last-child'); }),
  ] },
  { n: 'Chapter 6', t: 'Quotes', s: 'From template to accepted rental', steps: [
    S('Anita starts a quote for Malabar from the Studio Fleet Yearly template.', async () => {
      await D.click({ sel: '.nav button', text: 'Quote templates' }); await sleep(800); await D.clickIn('tr', 'Studio Fleet Yearly', 'Create quote');
    }),
    S('Twenty-five cameras with the lens kit, starting on the first of November, using the volume discount.', async () => {
      await D.select('customer_id', 'Malabar'); await D.type('[name=quantity]', '25'); await D.val('start_date', '2026-11-01'); await D.type('[name=discount_code]', 'VOLUME10');
      await D.click({ sel: '#modal-root [data-submit]' });
    }, '25 cameras with the 24–70mm lens kit from 1 November, using VOLUME10.'),
    S('The quote is valid for fifteen days, and the price preview applies the discount before tax.', async () => { await sleep(1200); await D.hover('#modal-root .lines'); }),
    S('Malabar Logistics signs in to its own portal, tucks the flash deals away, and opens the quote.', async () => {
      await D.click({ sel: '[data-close]' }); await D.login('Malabar'); await sleep(1400); await D.click({ sel: '.deck-close' });
      await D.click({ sel: '.nav button', text: 'My rentals' }); await sleep(800); await D.clickIn('tr', 'Pro Camera Yearly', 'Open');
    }),
    S('One click accepts it, and the rental is confirmed from the first of November.', () => D.click({ within: '#modal-root', text: 'Accept quote' })),
  ] },
  { n: 'Chapter 7', t: 'Billing day', s: '1 November', steps: [
    S('To simulate the month, the admin can move the business date. Anita sets it to the first of November.', async () => { await D.login('Anita'); await D.setDate('2026-11-01'); }),
    S('Meera from finance signs in, and runs billing. It finds every active rental that is due, and creates draft invoices.', async () => {
      await D.login('Meera'); await D.click({ sel: '.nav button', text: 'Invoices' }); await sleep(800); await D.click({ text: 'Run billing' });
    }),
    S("Malabar's invoice: twenty-five cameras at twelve thousand five hundred and sixty rupees, minus the ten percent volume discount, plus eighteen percent G.S.T. That's three lakh, thirty-three thousand, four hundred and sixty-eight rupees.", async () => {
      await sleep(600); await D.clickIn('tr', 'Malabar', 'Open'); await sleep(900); await D.hover('#modal-root .lines');
    }, 'Malabar: 25 × ₹12,560, minus 10% VOLUME10, plus 18% GST = ₹3,33,468.'),
    S("Meera confirms the invoice and sends it, so it appears in the customer's portal.", async () => {
      await D.click({ within: '#modal-root', text: 'Confirm' }); await sleep(900); await D.clickIn('tr', 'Malabar', 'Open'); await sleep(800); await D.click({ within: '#modal-root', text: 'Send to customer' });
    }),
    S('Kochi Bakes gets nine hundred and ninety-nine rupees plus G.S.T., which is one thousand, one hundred and seventy-eight rupees and eighty-two paise.', async () => {
      await D.clickIn('tr', 'Kochi', 'Open'); await sleep(800); await D.click({ within: '#modal-root', text: 'Confirm' }); await sleep(900);
      await D.clickIn('tr', 'Kochi', 'Open'); await sleep(800); await D.click({ within: '#modal-root', text: 'Send to customer' });
    }, 'Kochi Bakes: ₹999 + 18% GST = ₹1,178.82.'),
    S("Running billing again creates nothing. The database won't allow two invoices for the same rental period.", () => D.click({ text: 'Run billing' })),
  ] },
  { n: 'Chapter 8', t: 'Payments', s: 'Full and part payments', steps: [
    S('Kochi Bakes pays in full, by U.P.I. The invoice moves to paid.', async () => {
      await D.clickIn('tr', 'Kochi', 'Open'); await sleep(800); await D.click({ within: '#modal-root', text: 'Record payment' }); await sleep(700);
      await D.val('date', '2026-11-03'); await D.click({ sel: '#modal-root [data-submit]' });
    }, 'Kochi Bakes pays in full by UPI. The invoice moves to Paid.'),
    S('Malabar pays two lakh rupees by bank transfer, as a part payment.', async () => {
      await D.clickIn('tr', 'Malabar', 'Open'); await sleep(800); await D.click({ within: '#modal-root', text: 'Record payment' }); await sleep(700);
      await D.type('[name=amount]', '200000'); await D.select('method', 'Bank transfer'); await D.val('date', '2026-11-20');
      await D.type('[name=note]', 'Part payment, PO #7781'); await D.click({ sel: '#modal-root [data-submit]' });
    }, 'Malabar pays ₹2,00,000 by bank transfer (part payment, PO #7781).'),
    S('A payment can never be more than what is still owed. Malabar still owes one lakh, thirty-three thousand, four hundred and sixty-eight rupees.', () => D.hover('tbody tr'),
      'A payment can never exceed what is owed. Malabar still owes ₹1,33,468.'),
  ] },
  { n: 'Chapter 9', t: 'Dashboard', s: 'Overdue on 2 December', steps: [
    S("On the second of December, Malabar's invoice is past its due date.", async () => { await D.login('Anita'); await D.setDate('2026-12-02'); }),
    S('The finance dashboard shows monthly recurring revenue, the amount outstanding, overdue invoices, and pending requests.', async () => {
      await D.click({ sel: '.nav button', text: 'Dashboard' }); await sleep(900); await D.hover('.tile.hero'); await sleep(900); await D.hover('.tiles .tile:nth-child(4)'); await sleep(800); await D.hover('.tile.bad');
    }),
    S('Overdue invoices land in the chase list, and everything can be filtered by date, plan, customer, status and staff member.', async () => {
      await D.hover('.grid2 .card'); await sleep(900); await D.select('customer_id', 'Malabar', '.filters'); await sleep(1500); await D.click({ text: 'Clear' });
    }),
  ] },
  { n: 'Chapter 10', t: 'Reports', s: 'Revenue, discounts and ageing', steps: [
    S('Reports show revenue by plan, how much each discount gave away, and the ageing of unpaid invoices.', async () => {
      await D.click({ sel: '.nav button', text: 'Reports' }); await sleep(1000); await D.scroll(500); await sleep(1500); await D.scroll(0);
    }),
  ] },
  { n: 'Chapter 11', t: 'Users & access', s: 'Roles, overrides and audit trail', steps: [
    S('Anita manages people from Users and access. Users are deactivated rather than deleted, so their history is kept.', () => D.click({ sel: '.nav button', text: 'Users' })),
    S('Each tab has a default access level for each role, which can be overridden for one person.', async () => {
      await D.clickIn('tr', 'Rahul', 'Access'); await sleep(2500); await D.click({ sel: '[data-close]' });
    }),
    S('Every change, approval and payment is recorded in the audit log.', () => D.click({ sel: '.tabs button', text: 'Audit log' })),
  ] },
  { n: 'Chapter 12', t: 'Catalogue', s: 'Gear, photos and themes', steps: [
    S('The catalogue holds every camera, lens and accessory, with its price, cost and kit options.', async () => {
      await D.click({ sel: '.nav button', text: 'Cameras' }); await sleep(900); await D.scroll(600); await sleep(1200); await D.scroll(0);
    }),
    S('Admins can upload their own product photos, and every invoice can be printed or saved as a P.D.F.', () => D.hover({ text: 'Upload photo' }),
      'Admins can upload their own product photos, and every invoice can be printed or saved as a PDF.'),
    S('And a light theme is one click away.', async () => { await D.click({ sel: '.top .iconbtn' }); await sleep(2200); await D.click({ sel: '.top .iconbtn' }); }),
  ] },
  { n: 'That’s LensUS', t: 'Thanks for watching', s: 'Rentals · flash sales · approvals · GST billing · payments · reports', steps: [
    S('That is LensUS: rentals, flash sales, approvals, G.S.T. billing, payments and reports, all in one offline app. Thanks for watching.', () => sleep(500),
      'That’s LensUS: rentals, flash sales, approvals, GST billing, payments and reports, all in one offline app. Thanks for watching!'),
  ] },
];

// ---------------------------------------------------------------- text to speech
function synthesize(lines) {
  const list = path.join(WORK, 'lines.json');
  fs.writeFileSync(list, JSON.stringify(lines.map((t, i) => ({ t, f: path.join(WORK, `line-${String(i).padStart(3, '0')}.wav`) }))));
  const ps = path.join(WORK, 'tts.ps1');
  fs.writeFileSync(ps, `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop'); $s.Rate = 0; $s.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($l in (Get-Content -Raw -Encoding UTF8 '${list}' | ConvertFrom-Json)) { $s.SetOutputToWaveFile($l.f, $fmt); $s.Speak($l.t) }
$s.SetOutputToNull()`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { stdio: 'inherit' });
  return lines.map((_, i) => {
    const buf = fs.readFileSync(path.join(WORK, `line-${String(i).padStart(3, '0')}.wav`));
    let p = 12; while (buf.toString('ascii', p, p + 4) !== 'data') p += 8 + buf.readUInt32LE(p + 4);
    const pcm = buf.subarray(p + 8, p + 8 + buf.readUInt32LE(p + 4));
    return { pcm, dur: pcm.length / (22050 * 2) };
  });
}

// ---------------------------------------------------------------- in-page demo helpers (cursor, captions, chapter cards)
const PAGE_HELPERS = `(() => { if (window.__demo) return;
const st = document.createElement('style'); st.textContent = \`
#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(800px,450px);transition:transform .6s cubic-bezier(.2,.7,.2,1)}
#__cur svg{width:26px;height:26px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}
#__ring{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #fbbf24;border-radius:10px;box-shadow:0 0 0 5px rgba(251,191,36,.22);opacity:0;transition:all .35s}
#__rip{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #fbbf24;opacity:0}
#__rip.go{animation:__r .5s ease-out}@keyframes __r{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.6)}}
#__cap{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);max-width:76%;z-index:2147483647;pointer-events:none;background:rgba(5,7,12,.88);color:#fff;font:500 25px/1.38 'Segoe UI',Arial,sans-serif;padding:12px 24px;border-radius:12px;text-align:center;border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 30px rgba(0,0,0,.4)}
#__cap:empty{display:none}
#__chap{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 45%,rgba(37,99,235,.35),rgba(5,7,12,.94) 60%);color:#fff;opacity:0;transition:opacity .45s;pointer-events:none;font-family:Exo,'Segoe UI',sans-serif}
#__chap.on{opacity:1}#__chap .n{font:600 16px 'Roboto Mono',monospace;letter-spacing:.32em;color:#fbbf24;text-transform:uppercase}
#__chap .t{font-size:72px;font-weight:600;margin-top:14px}#__chap .s{font-size:24px;color:#cbd5e1;margin-top:10px}\`;
document.head.appendChild(st);
const mk = (id, html) => { const e = document.createElement('div'); e.id = id; e.innerHTML = html || ''; document.body.appendChild(e); return e; };
const cur = mk('__cur', '<svg viewBox="0 0 24 24"><path d="M4 2l6.5 19 2.6-7.6L21 11z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>');
const ring = mk('__ring'), rip = mk('__rip'), cap = mk('__cap'), chap = mk('__chap', '<div class="n"></div><div class="t"></div><div class="s"></div>');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
async function find(q, tries = 30) {
  for (let i = 0; i < tries; i++) {
    let el = null;
    if (typeof q === 'string') el = document.querySelector(q);
    else {
      const root = q.within ? document.querySelector(q.within) : document;
      const all = root ? [...root.querySelectorAll(q.sel || 'button, a, [role=tab], .chip')] : [];
      el = all.filter(vis).find(e => !q.text || e.textContent.replace(/\\s+/g, ' ').includes(q.text));
    }
    if (vis(el)) return el;
    await sleep(100);
  }
  throw new Error('not found: ' + JSON.stringify(q));
}
async function moveTo(el) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await sleep(120);
  const r = el.getBoundingClientRect();
  cur.style.transform = 'translate(' + (r.left + Math.min(r.width / 2, 60)) + 'px,' + (r.top + r.height / 2) + 'px)';
  Object.assign(ring.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px', opacity: 1 });
  await sleep(650);
  return r;
}
const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
window.__demo = {
  async hover(q) { const el = await find(q); await moveTo(el); await sleep(400); ring.style.opacity = 0; },
  async click(q) {
    const el = await find(q); const r = await moveTo(el);
    Object.assign(rip.style, { left: r.left + Math.min(r.width / 2, 60) + 'px', top: r.top + r.height / 2 + 'px' });
    rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go');
    el.click(); await sleep(250); ring.style.opacity = 0;
  },
  async clickIn(rowSel, rowText, btnText) {
    const row = await find({ sel: rowSel, text: rowText });
    const btn = [...row.querySelectorAll('button, a')].filter(vis).find(b => b.textContent.includes(btnText));
    if (!btn) throw new Error('button ' + btnText + ' not in row ' + rowText);
    btn.scrollIntoView({ block: 'center' }); await sleep(300);
    const r = await moveTo(btn); Object.assign(rip.style, { left: r.left + r.width / 2 + 'px', top: r.top + r.height / 2 + 'px' });
    rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go'); btn.click(); await sleep(250); ring.style.opacity = 0;
  },
  async type(sel, text) {
    const el = await find(sel); await moveTo(el); el.focus(); el.value = '';
    for (const ch of text) { el.value += ch; fire(el, 'input'); await sleep(45); }
    fire(el, 'change'); ring.style.opacity = 0; await sleep(150);
  },
  async select(name, label, within = '#modal-root') {
    const el = await find(within + ' [name="' + name + '"]'); await moveTo(el);
    const o = [...el.options].find(o => o.textContent.includes(label)); if (!o) throw new Error('option ' + label);
    el.value = o.value; fire(el, 'input'); fire(el, 'change'); await sleep(400); ring.style.opacity = 0;
  },
  async val(name, v) {
    const el = await find('#modal-root [name="' + name + '"]'); await moveTo(el);
    el.value = v; fire(el, 'input'); fire(el, 'change'); await sleep(350); ring.style.opacity = 0;
  },
  async setDate(v) { const el = await find('#bizdate'); await moveTo(el); el.value = v; fire(el, 'change'); await sleep(1200); ring.style.opacity = 0; },
  scroll(y) { const m = document.querySelector('.main') || document.scrollingElement; m.scrollTo({ top: y, behavior: 'smooth' }); },
  caption(t) { cap.textContent = t || ''; },
  chapter(n, t, s) { chap.querySelector('.n').textContent = n; chap.querySelector('.t').textContent = t; chap.querySelector('.s').textContent = s; chap.classList.add('on'); },
  unchapter() { chap.classList.remove('on'); },
};
})()`;

// ---------------------------------------------------------------- main
app.whenReady().then(async () => {
  const errors = [];
  const allSteps = STORY.flatMap(c => c.steps);
  console.log(`Synthesizing ${allSteps.length} narration lines...`);
  const clips = synthesize(allSteps.map(s => s.say));
  console.log('Narration total', clips.reduce((a, c) => a + c.dur, 0).toFixed(1), 's');

  const { port } = await start({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lensus-video-')) });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', e => { if (e.level === 'error') errors.push('console: ' + e.message.slice(0, 160)); });
  let latest = null;
  win.webContents.on('paint', (e, dirty, img) => { latest = img.toJPEG(90); });
  win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript(PAGE_HELPERS));
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(1200);

  const js = code => win.webContents.executeJavaScript(code);
  const call = (fn, ...args) => js(`__demo.${fn}(${args.map(a => JSON.stringify(a)).join(',')})`);
  global.key = async k => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await sleep(200); };
  D = {
    hover: q => call('hover', q), click: q => call('click', q), clickIn: (a, b, c) => call('clickIn', a, b, c),
    type: (s, t) => call('type', s, t), select: (n, l, w) => call('select', n, l, w), val: (n, v) => call('val', n, v),
    setDate: v => call('setDate', v), scroll: y => call('scroll', y),
    async login(who) {
      if (await js("!!document.querySelector('.side')")) { await D.click({ text: 'Sign out' }); await sleep(900); }
      await D.click({ sel: '.demo button', text: who }); await sleep(300); await D.click({ text: 'Sign in' }); await sleep(1300);
    },
  };

  // Video encoder fed in real time; frames are duplicated as needed so video time == wall-clock time.
  const videoFile = path.join(WORK, 'video.mp4');
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=1600:900:flags=lanczos,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), videoFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  let written = 0;
  const pump = setInterval(() => {
    const due = Math.floor((Date.now() - t0) / 1000 * FPS);
    while (written < due && latest) { ff.stdin.write(latest); written++; }
  }, 1000 / FPS / 2);
  const now = () => (Date.now() - t0) / 1000;

  const cues = [];
  let idx = 0;
  await sleep(600);
  for (const ch of STORY) {
    await call('caption', '');
    await call('chapter', ch.n, ch.t, ch.s); await sleep(2300); await call('unchapter'); await sleep(500);
    for (const step of ch.steps) {
      const clip = clips[idx++];
      const at = now();
      cues.push({ at, clip, cap: step.cap });
      await call('caption', step.cap);
      const action = (async () => { try { await step.act(); } catch (e) { errors.push(`[${ch.t}] ${step.cap.slice(0, 50)}…: ${e.message}`); } })();
      await Promise.all([action, sleep(clip.dur * 1000)]);
      const left = at + clip.dur + 0.45 - now(); if (left > 0) await sleep(left * 1000);
    }
  }
  await call('caption', ''); await sleep(1500);
  clearInterval(pump);
  const total = written / FPS;
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));

  // Narration track aligned to the cue times.
  const rate = 22050, pcm = Buffer.alloc(Math.ceil(total * rate) * 2);
  for (const c of cues) c.clip.pcm.copy(pcm, Math.min(Math.round(c.at * rate) * 2, pcm.length), 0, Math.max(0, Math.min(c.clip.pcm.length, pcm.length - Math.round(c.at * rate) * 2)));
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  const wav = path.join(WORK, 'narration.wav');
  fs.writeFileSync(wav, Buffer.concat([hdr, pcm]));

  // Subtitles.
  const ts = s => { const ms = Math.round(s * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  fs.writeFileSync(OUT_SRT, '\ufeff' + cues.map((c, i) => `${i + 1}\n${ts(c.at)} --> ${ts(c.at + c.clip.dur + 0.3)}\n${c.cap}\n`).join('\n'));

  // Mux: video + voiceover (AAC) + soft English subtitle track (captions are also drawn into the picture).
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', videoFile, '-i', wav, '-i', OUT_SRT, '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-af', 'loudnorm=I=-16:TP=-1.5', '-ar', '48000', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
    '-metadata', 'title=LensUS walkthrough', '-movflags', '+faststart', OUT_MP4], { stdio: 'inherit' });

  console.log(JSON.stringify({ seconds: +total.toFixed(1), frames: written, cues: cues.length, mp4: OUT_MP4, srt: OUT_SRT, errors }, null, 1));
  app.exit(0);
}).catch(e => { console.error('FAILED', e); app.exit(1); });
