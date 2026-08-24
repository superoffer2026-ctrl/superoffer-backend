# SuperOffer Backend Specification

**Purpose:** build the backend fast and correctly by reading these documents
instead of re-reading the Angular frontend.

**How this was produced:** by reading `superoffer-frontend/src/app` end to end —
all 10,060 lines across every module. Every field name, status value, validation
rule, and business rule below was copied out of working frontend code. Nothing is
invented. File references are given throughout so any claim can be verified.

---

## The rule that governs everything

**The frontend already defines the API.** `src/app/core/auth-api.service.ts` is a
complete list of every endpoint the app calls — exact paths, methods, headers and
payloads. The frontend is fixed and will not change.

So the backend's job is to **match an existing contract**, not to design one. Any
deviation breaks a screen. When these docs and your instinct disagree, the docs win;
when the docs and the frontend disagree, the frontend wins — and please fix the doc.

---

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 01 | [System Overview](01-System-Overview.md) | Who the users are, what the portals do, how a user flows through the product |
| 02 | [API Contract](02-API-Contract.md) | Every endpoint, with request and response shapes |
| 03 | [Data Models](03-Data-Models.md) | The data each module stores, and why |
| 04 | [Student Profile Module](04-Student-Profile-Module.md) | The 9-step wizard: every field and validation rule |
| 05 | [Organization Module](05-Organization-Module.md) | Universities and banks: products, criteria, discovery, team, subscription |
| 06 | [Offers Module](06-Offers-Module.md) | Offers, invitations, negotiation, the student wallet |
| 07 | [Admin Module](07-Admin-Module.md) | Approval queue and audit log |
| 08 | [Reference Data](08-Reference-Data.md) | The 8 dropdown endpoints — the best place to start building |
| 09 | [Business Rules](09-Business-Rules.md) | Non-obvious logic that must live server-side |
| 10 | [Open Decisions](10-Open-Decisions.md) | Ambiguities to resolve **before** writing schemas |
| 11 | [Build Order](11-Build-Order.md) | What to build in what order, and why |

**Before writing any schema, read [10-Open-Decisions.md](10-Open-Decisions.md).**
Several genuine ambiguities exist in the frontend, and each one changes the database
design. Deciding them after the fact means migrations.

---

## Conventions used in these docs

- `POST /auth/login` means `POST /api/v1/auth/login` — the `/api/v1` prefix is
  implied everywhere and is already implemented.
- **Bold** field names are required.
- Field names are written exactly as the frontend sends or expects them. Casing
  matters: `fullName` is not `full_name`. (One module breaks this rule — see
  Open Decision 1.)

## Current state

**Stack:** NestJS · Prisma · PostgreSQL. These documents were written against an
earlier Express + MongoDB plan; the schema advice in 03 and 05 should be read as
*what to store*, not *how to store it*. `prisma/schema.prisma` is the source of
truth for shapes, and `API_DOCUMENTATION.md` for the live API.

Built and verified end to end:

- **Auth** — institution email/password with approval gating and lockout; student
  phone + WhatsApp OTP.
- **Reference data** — all eight `/reference/*` endpoints (Step 2 of the build
  order), generated from the master data sheet. See 08.
- **Student profile** — the nine-step wizard's eight section endpoints, each
  validated against the same constants the reference endpoints serve, with the
  derived-value rules from 09 enforced server-side.
- **Documents** — upload, replace, preview, delete.
- **Offers** — the model, the student wallet, the organization side, and the
  lifecycle rules from 06 (14-day expiry, terminal states, one-way withdrawal).
- **Discovery** — organization-side student search over submitted profiles.
- **Admin** — approval queue and audit log.

Open decisions 1, 2, 3, 6, 7, 8, 10 and 11 in [10-Open-Decisions.md](10-Open-Decisions.md)
have been resolved by the implementation; that document records the reasoning but
no longer describes open questions.
