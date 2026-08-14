# 11 — Build Order

Each step is independently shippable and testable. The order is chosen so that
**unresolved decisions never block the next step**.

| Step | Module | Depends on | Decisions needed |
|---|---|---|---|
| ✅ 1 | Foundation | — | — |
| 2 | Reference data | — | none |
| 3 | Auth (users, register, login, JWT) | 2 | 1, 6 |
| 4 | Organization registration + admin approval | 3 | 1, 3 |
| 5 | Student profile (9 sections + submit) | 3 | 2 |
| 6 | Document upload | 5 | 7 |
| 7 | Products / catalog | 4 | — |
| 8 | Student discovery + filters | 5, 7 | — |
| 9 | Offers, invitations, messaging | 8 | 4, 5, 8 |
| 10 | Dashboards, reports, subscriptions | 9 | 12 |
| 11 | OTP login | 3 | — |

---

## Step 2 — Reference data ← start here

**Why first:** the only module with **zero dependencies and zero open decisions**.
No auth, no database, no schema. It lets you validate the whole architecture —
routes → controllers → services → constants → response shape — on something that
cannot go wrong, and it immediately unblocks every dropdown in the frontend.

Build:
- `src/constants/*.js` — one file per domain
- `src/routes/reference.routes.js` + `reference.controller.js`
- 8 endpoints, all public, all `GET`

Done when: all 8 return their documented keys, and the student wizard's dropdowns
populate against the real backend.

Spec: [08-Reference-Data.md](08-Reference-Data.md)

---

## Step 3 — Auth

Build: `users` model, `POST /auth/register`, `POST /auth/login`, `GET /auth/me`,
`GET /auth/status/:userId`, JWT signing/verification, `requireAuth` middleware,
bcrypt hashing.

Non-obvious requirements:
- Student register **must not** return a session ("Please log in to continue").
- Login **must** return `user.organization.organizationType`.
- Reject `PENDING`/`REJECTED` organizations at login.
- **401 only ever means "bad or expired token."** Validation errors are 400 —
  a 401 logs the user out and loses their form.

Done when: a student can register, log in, and `GET /auth/me` with the token.

Spec: [02](02-API-Contract.md) · Decisions 1, 6

---

## Step 4 — Organization registration + admin approval

Build: `organizations` model, org registration branch, `x-admin-key` middleware,
the three admin endpoints, `auditLog`.

Non-obvious requirements:
- Rejection reason required when rejecting.
- Approval flips the login gate — test that a PENDING org actually cannot log in.
- The admin queue polls every 15s; keep the list endpoint cheap.

Spec: [07-Admin-Module.md](07-Admin-Module.md) · Decisions 1, 3

---

## Step 5 — Student profile

The largest surface, but mostly mechanical once auth exists: 9 section endpoints,
`GET /students/me`, and submit.

Non-obvious requirements:
- **Section keys in the GET response ≠ endpoint names.** Get this right first —
  it breaks nine components silently. See the mapping table in
  [02](02-API-Contract.md).
- Both exam endpoints write into one `entranceExams` object.
- Every section is an independent idempotent upsert; partial profiles are normal.
- Recompute derived values server-side (`phone`, `location`,
  `annualHouseholdIncome`, and the flat academic fields).
- Rebuild `searchFields` on every save.
- Submit validates completeness, then sets `SUBMITTED` + `submittedAt`.

Done when: the wizard completes end-to-end against the real backend, survives a
page reload mid-wizard, and the student appears as SUBMITTED.

Spec: [04-Student-Profile-Module.md](04-Student-Profile-Module.md) · Decision 2

---

## Step 6 — Documents

Build: `documents` model, multipart upload, replace, delete, list.
**Blocked on Decision 7** (where files live).

Non-obvious requirements:
- `documentType` is a display label, not an enum.
- Re-uploading a type replaces the previous file.
- Required list varies by study level — serve it from reference data.
- Do not force `content-type: application/json` on this route.

---

## Step 7 — Products

Build: `products` model (PROGRAM + LOAN discriminated), org-scoped CRUD, criteria,
templates.

No frontend contract exists yet — the workspace uses demo data — so you can design
these endpoints. Match the shapes in [05](05-Organization-Module.md) so wiring the
frontend later is mechanical.

---

## Step 8 — Discovery

Build: the search endpoint with 21 filters, pagination, indexes, and the quota +
visibility rules.

Non-obvious requirements:
- Filter only `status: 'SUBMITTED'`.
- Filter on numeric `searchFields`, never by parsing display strings.
- `universityName` / `universityCourse` / `offerStatus` query **inside**
  `universityInterests[]`.
- Enforce `bankEvaluationMode` server-side — it's access control.
- Enforce subscription quota and plan-gated advanced filters server-side.
- Respect the 15s client timeout: paginate.

Spec: [05](05-Organization-Module.md) · [09](09-Business-Rules.md)

---

## Step 9 — Offers

Build: `offers` model, create/send, student decisions, negotiation messages,
withdrawal, expiry.

Non-obvious requirements:
- Four distinct status vocabularies — don't merge them.
- 14-day expiry **derived from `sentAt`**, not stored.
- Terminal states are final.
- `JourneyStage` derived, never persisted.
- Return wallet counters from an aggregation.

Spec: [06-Offers-Module.md](06-Offers-Module.md) · Decisions 4, 5, 8

---

## Steps 10–11

Dashboards and reports (aggregations over offers), subscriptions and quota cycles
(Decision 12), then OTP login as an additional flow alongside password login.

---

## Working rules

From the project's own conventions:

1. No business logic in routes — routes map URLs to controllers.
2. No database queries in routes.
3. Controllers thin, services own logic, models own schema.
4. Config stays out of application logic.
5. `async/await` throughout.
6. Use the shared response helpers; never hand-build a shape.
7. Reference lists defined once, shared by route and validator.
8. Don't create files before they're needed.
9. Don't build ahead of the step you're on.

**Definition of done for every step:** the relevant frontend screen works against
the real backend — not just a passing unit test.
