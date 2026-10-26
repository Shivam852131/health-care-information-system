# MediCore HIS — Healthcare Information System

A complete, self-contained healthcare information system built with **Next.js (App Router)**, **React** and the built-in **`node:sqlite`** database. It implements every module in the PRD: authentication, patients, doctors, appointments, medical records, laboratory, billing, prescriptions, reports and administration — with five roles, record-level authorisation and a full audit trail.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:3001
```

The app **auto-seeds itself** on first run: the SQLite database is created at `data/his.db` and populated with demo doctors, patients, appointments, records, lab tests, prescriptions and invoices.

### Resetting the demo data

```bash
npm run reseed
```

Wipes every table (resetting auto-increment ids), rebuilds the pristine demo dataset and clears stale uploads — all inside a single transaction on its own connection, so it is **safe to run while `npm run dev` is up**. The running server only ever sees the old dataset or the new one, never a half-wiped state. Prefer this over deleting `data/his.db`, which requires a restart.

> **Port 3001** — `3000` is reserved by other software on this machine, so the dev server is pinned to `3001`.

### Production build

```bash
npm run build
npm start
```

### Smoke test

```powershell
powershell -ExecutionPolicy Bypass -File .\smoke-test.ps1
```

153 assertions covering every module: role permissions, conflict-free scheduling, validation errors, payment maths, file upload type/size checks, audit events and unauthenticated access. All currently pass.

---

## Demo logins

Password for **every** demo account is `demo123`.

| Role | Email | Sees |
|---|---|---|
| Administrator | `admin@demo.local` | Everything, plus user management, audit log and settings |
| Doctor | `priya@demo.local` | Own schedule, records, prescriptions, lab orders, reports |
| Patient | `aarav@demo.local` | **Only their own** appointments, records, labs, prescriptions, bills |
| Laboratory staff | `lab@demo.local` | Lab work queue, result entry, report file upload/download |
| Receptionist | `reception@demo.local` | Registration, scheduling, billing, payments — no clinical notes |

The login screen lists these as one-click chips that fill the form for you.

---

## Interface & shortcuts

The UI is hand-built for a fast clinical workflow — no component framework, just a design system in `app/globals.css`.

* **Dark mode** — a three-state theme (light / dark / follow-system) stored in `localStorage` and applied before first paint by an inline bootstrap script, so there is no flash of the wrong theme on load. Toggle from the header, the account menu or the login screen.
* **Command palette** — press **⌘K** (macOS) or **Ctrl+K** (Windows/Linux) anywhere to search patients, doctors, appointments and invoices, or to jump straight to a page. Results and quick actions are **role-scoped**, so a lab technician never sees admin commands and a patient never sees clinical-entry actions. Navigate with **↑ / ↓**, confirm with **Enter**, dismiss with **Esc**.
* **Data tables** — every list column is client-side sortable (click a header to cycle ascending → descending → unsorted) with proper `aria-sort` attributes for screen readers, plus pagination on the longer lists.
* **Sidebar rail** — collapse the navigation to an icon rail; the choice persists across pages and sessions.
* **Modals** — trap focus, close on **Esc**, and return focus to the element that opened them.
* **Feedback** — non-blocking toasts (`aria-live="polite"`) for success/error, skeleton loaders instead of spinners while data loads, and inline field validation.

| Shortcut | Action |
|---|---|
| **⌘K** / **Ctrl+K** | Open the command palette |
| **↑** / **↓** | Move through palette results |
| **Enter** | Activate the selected result |
| **Esc** | Close palette or modal |

---

## Architecture

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js App Router, JavaScript | Server routes and UI in one app, no extra build tooling |
| Database | `node:sqlite` (built-in) | Zero native dependencies; a single file you can delete to reset |
| Styling | Hand-written CSS (`app/globals.css`) | No UI framework, no Tailwind, nothing native to compile |
| Auth | Signed HMAC session cookie (`his_session`, 12 h) + `scrypt` password hashes | Stateless verification, no session table to clean up |
| Uploads | `uploads/` directory, name uniquified on save | Files never overwrite each other |

```
app/            pages (App Router) + api/ route handlers
components/     shared UI: AppShell, DataTable, CommandPalette, Modal, Toaster, charts, print sheets
lib/            db (incl. reseed), auth, audit, validation, theme, client helpers
scripts/        reseed.js — restores the pristine demo dataset (npm run reseed)
data/his.db     SQLite database (auto-created, safe to delete)
uploads/        uploaded lab report files
smoke-test.ps1  153-assertion end-to-end suite
```

### Security model

* **Authentication** — `requireUser()` runs server-side in every API route and returns `401` for anonymous callers. Passwords are hashed with `scrypt` and a per-user salt.
* **Authorisation** — two layers. *Role checks* (`can(user, 'invoice:create')`) gate actions; *record-level checks* scope queries, so a patient hitting `/api/patients/42` gets `403` unless `42` is their own record.
* **Validation** — every write validates on the server, returning `400` with a human-readable message. The client mirrors these rules for instant feedback, but the server is the source of truth.
* **Audit trail** — patient creation, appointment changes, record edits, lab results, payments, invoice creation, prescriptions and user creation are all written to the audit log with actor, entity, timestamp and a plain-English change summary. Visible under *Administration → Audit*.
* **File uploads** — extension allow-list plus a 5 MB cap, both enforced server-side. Files are served back with `Content-Disposition: attachment` so a stored report can never execute in the browser, and `path.basename()` blocks path traversal.
* **Money** — invoice totals, discounts, paid amounts and balances are computed **only** on the server. Over-payment is rejected, and paying a settled invoice is rejected.

### Appointment conflict prevention

A partial unique index in SQLite on `(doctor_id, date, time)` where the status is still `scheduled` makes double-booking impossible at the database level, not just in the UI. A conflicting booking returns `409` with a message naming the exact slot. Cancelling or completing an appointment frees the slot again.

---

## Module coverage

1. **Authentication** — login/logout, session cookie, role-aware redirect after sign-in.
2. **Patients** — registry, search, registration with portal-account option, full profile with tabs for history, appointments, labs, prescriptions and billing.
3. **Doctors** — directory with stats, per-day schedule editor, fee and availability management.
4. **Appointments** — slot picker driven by each doctor's availability, conflict-free booking, reschedule, complete, cancel, no-show.
5. **Medical Records** — consultation notes with diagnosis and treatment, version/audit fields on edit.
6. **Laboratory** — order tests, track `requested → in_progress → completed`, enter results, upload and download report files.
7. **Billing** — invoices with line items, server-computed totals, discounts, partial and full payments, printable invoice sheet.
8. **Prescriptions** — dynamic medicine rows (dose, frequency, duration, notes), printable prescription sheet.
9. **Reports** — 30 / 90 / 180 / 365-day period selector with appointment, revenue and clinical charts.
10. **Administration** — user management, audit log with action filter, system settings.

---

## Notes for reviewers

* Data left over from the smoke test (patients named *Smoke Tester*, extra users) will appear in the demo data — this is expected and proves the suite ran. Run `npm run reseed` for a pristine seed (safe while the dev server is running), or delete `data/his.db` and restart.
* Re-run `smoke-test.ps1` after any change; it writes to a scratch patient/user with a random suffix so it does not collide with itself, and it self-heals its own appointment fixture so it can run back-to-back.
* **Note:** run `npm run build` with the dev server stopped — the two share the `.next` directory and building underneath a running `next dev` can wedge its chunk compilation.
