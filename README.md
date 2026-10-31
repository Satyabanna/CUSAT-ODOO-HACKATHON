# LensUS

**Camera & accessories rental desk** — rental plans, quotes, approvals, GST billing, payments, reports and flash sales, in one offline Windows desktop app.

Built from the *Subscription Management System — Brightloop case study*: the business rules (role/tab access control, request approvals, plan price locking, billing runs, payment rules, MRR, ageing) follow that document, re-themed as a camera and gear rental business.

- **Desktop app** — Electron shell running a local Express API on `127.0.0.1` with a SQLite database (sql.js / WebAssembly, so no native build tools are needed).
- **Fully offline** — runtime, database engine, fonts and product art are bundled; the built exe downloads nothing.
- **Three roles** — admin, internal staff and customers (self-service portal), with per-user tab access overrides enforced on every API route.

## Features

| Area | What it does |
|------|--------------|
| Users & access | Staff accounts, deactivation (never delete), password resets, role defaults + per-user overrides (none / view / edit / full), audit log |
| Catalogue | 15 products (cameras, drone, lenses, lighting, audio, power, support) with kit variants, GST, product images and photo upload |
| Rental plans | Monthly / yearly plans; price locked once rented — changes create a new plan version |
| Discounts & flash sales | Date windows, minimum quantity, usage limits; flash sales appear to customers as a stacked card deck with countdowns |
| Requests | Staff and customers raise requests (discounts, custom prices, plans, products, pause/close/upgrade, refunds); approval creates the real record automatically |
| Rentals & quotes | Draft → quotation → confirmed → active → paused / closed / expired; quote templates with validity; renewals and auto-close |
| Billing & invoices | Idempotent billing run (one invoice per rental period, enforced by the database), discount before tax, Net 30, overdue flagging, print / PDF |
| Payments | Full and part payments, never more than the balance, refunds via approved requests |
| Dashboard & reports | MRR, collected, outstanding, overdue, pending requests, filters; revenue by plan, discount usage, ageing (0–30 / 31–60 / 60+) |

A **business date** control (admin) lets you simulate time: quotes expire, rentals activate and renew, and invoices go overdue as the date moves.

## Getting started

Requires Node.js 20+ (Windows for building the exe).

```bash
npm install
npm start          # run the desktop app
npm run serve      # or run API + UI in a browser at http://127.0.0.1:4300
npm test           # end-to-end check of the case-study figures, access rules and flash sales
npm run dist       # build dist/LensUS-<version>-portable.exe and -setup.exe
```

Data is stored in `%APPDATA%\LensUS\brightloop.db` for the desktop app (File → Open data folder), or `./data/` for `npm run serve`. Delete the database file to reset to the demo seed.

### Demo accounts

| Who | Role | Email | Password |
|-----|------|-------|----------|
| Anita | Admin | anita@brightloop.in | Admin@123 |
| Rahul | Staff (sales) | rahul@brightloop.in | Staff@123 |
| Meera | Staff (finance) | meera@brightloop.in | Staff@123 |
| Malabar Logistics | Customer | accounts@malabarlogistics.in | Malabar@123 |

These are shown on the sign-in screen for demos — remove them (`server/seed.js`, `DEMO` in `public/app.js`) before real use.

## The case-study month

Seed data starts at business date 31 Oct 2026.

1. Kochi Bakes signs up and rents *Creator Kit Monthly* from 1 Nov; Rahul confirms it.
2. Rahul requests discount VOLUME10 (10%, min 20, 1 Nov–31 Dec, 50 uses); Anita approves → it is created automatically.
3. A quote from *Studio Fleet Yearly* for Malabar (25 units, VOLUME10); Malabar accepts it in the portal.
4. Business date 1 Nov → **Run billing**: ₹3,33,468 (Malabar) and ₹1,178.82 (Kochi Bakes). Running it again creates nothing.
5. Confirm and send; record ₹1,178.82 by UPI and a ₹2,00,000 part payment.
6. Business date 2 Dec → Malabar is overdue with ₹1,33,468 outstanding; MRR ₹23,550 from Malabar.

`npm test` replays this month through the API and asserts every figure.

## Project layout

```
main.js, preload.js        Electron shell (window, PDF export bridge)
server/
  app.js                   Express API — every route checks tab permissions
  logic.js                 business rules: access, pricing, billing, jobs, requests
  reports.js               dashboard and reports
  db.js                    SQLite (sql.js) with file persistence and migrations
  seed.js                  demo data, rental catalogue, flash sales, product art
  print.js                 printable invoice
public/                    single-page UI (vanilla JS), styles, fonts, product art
test/scenario.test.js      end-to-end scenario test
tools/
  gen-product-art.js       regenerates the bundled product illustrations
  video/make-video.js      records the narrated, captioned walkthrough video (Windows)
```

### Walkthrough video

```bash
cd tools/video && npm install && cd ../..
npm run video      # -> dist/video/LensUS-walkthrough.mp4 + .srt
```

Uses the Windows built-in speech voices for narration and burns in captions, plus a soft subtitle track and an `.srt`.

## Notes

- The exe is not code-signed, so Windows SmartScreen may ask "More info → Run anyway" the first time.
- Email is simulated offline: password reset codes and notifications go to the in-app inbox (and the log).
