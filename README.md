# SuperOffer Backend

The REST API for **SuperOffer** — a reverse-admissions marketplace for
international education. Students build one structured profile and submit it
once; verified universities and banks search those profiles and come to the
student with concrete offers.

This README describes what **actually exists today**. Check
*Current state* at the bottom before assuming a feature is implemented.

---

## 1. Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | NestJS 10 |
| Database | **PostgreSQL** |
| ORM | **Prisma 5** |
| Auth | JWT access + refresh, sessions persisted in Postgres |
| Student login | WhatsApp number (+91, 10 digits) + password. A WhatsApp OTP proves the number once at registration, and again to reset a forgotten password. |
| Validation | `class-validator` DTOs via a global `ValidationPipe` |
| API style | REST, versioned under `/api/v1` |
| API docs | Swagger UI at `/api-docs` |

> **History note.** This repository briefly contained an Express 4 + Mongoose 8
> scaffold targeting MongoDB Atlas. It never grew past a `/health` route and
> defined no models. It was removed in favour of the NestJS + Prisma +
> PostgreSQL backend, which was developed in parallel inside the
> `superoffer-frontend` repository and merged here with its full history.
> **There is no MongoDB anywhere in this codebase.** Some documents under
> `docs/` still describe collections in Mongo terms — see §6.

---

## 2. Project structure

```
superoffer-backend/
├── prisma/
│   ├── schema.prisma         # the single source of truth for the database
│   └── migrations/           # 2 applied migrations
├── src/
│   ├── auth/                 # register, login, OTP, JWT strategy, guards
│   │   ├── dto/              # request shapes + validation rules
│   │   ├── jwt.strategy.ts   # verifies the bearer token
│   │   ├── roles.guard.ts    # enforces @Roles(...) on a handler
│   │   ├── otp.util.ts       # OTP generation + hashing
│   │   └── whatsapp-sender.ts# Meta Cloud API sender (mock if unconfigured)
│   ├── students/             # student profile read/write/submit
│   ├── documents/            # document upload/list/replace/preview/delete
│   ├── admin/                # verification queue, approvals, audit log
│   │   └── admin-key.guard.ts# x-admin-key header check
│   ├── prisma/               # PrismaService (one client, app-wide)
│   ├── health.controller.ts
│   ├── app.module.ts         # wires every module together
│   └── main.ts               # bootstrap: CORS, prefix, pipes, Swagger, listen
└── docs/                     # backend specification (01–11)
```

### How a request flows

```
HTTP  →  Guard (JwtAuthGuard / RolesGuard / AdminKeyGuard)
      →  ValidationPipe (DTO is checked and coerced)
      →  Controller (thin — no logic)
      →  Service (business logic)
      →  PrismaService  →  PostgreSQL
```

Guards run **before** validation. That ordering matters: an unauthenticated
request is rejected without the server ever parsing its body.

---

## 3. Data model

Seven tables, defined in `prisma/schema.prisma`:

| Table | Purpose |
|---|---|
| `users` | Auth only. Institutions use email+password; students use their WhatsApp number (`phone`) + password and hold no email at all. Carries `role`, `status`, lockout counters. |
| `organizations` | One row per registering university / bank. `verificationStatus` gates login. |
| `auth_sessions` | Hashed refresh tokens — enables revocation and "sign out other devices". |
| `otp_codes` | Student OTPs (`REGISTER` / `PASSWORD_RESET`). Hashed, attempt-counted, expiring. |
| `audit_log` | Append-only trail of Super Admin approvals and rejections. |
| `student_profiles` | The wizard's form groups stored as JSON columns, mirroring the UI's shape so no field-mapping layer is needed. |
| `student_documents` | File metadata; bytes live on disk/object storage, not in the database. |

---

## 4. Environment

Copy `.env.example` to `.env` and fill it in.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | `postgresql://user:pass@host:5432/superoffer?schema=public` |
| `AUTH_TOKEN_SECRET` | **yes** | ≥ 32 random characters |
| `ADMIN_APPROVAL_KEY` | **yes** | The Super Admin credential — there is no admin account |
| `OTP_HASH_SECRET` | **yes** | ≥ 32 random characters |
| `PORT` / `HOST` | no | Defaults `3000` / `0.0.0.0` |
| `CORS_ORIGIN` | no | Comma-separated; defaults to `http://localhost:4200` |
| `ACCESS_TOKEN_TTL_SECONDS` | no | Default 3600 |
| `REFRESH_TOKEN_TTL_SECONDS` | no | Default 2592000 (30 days) |
| `GALLABOX_API_KEY`, `GALLABOX_API_SECRET`, `GALLABOX_CHANNEL_ID` | no | Production WhatsApp sender; set all three to go live. `GALLABOX_OTP_TEMPLATE_NAME` / `GALLABOX_OTP_BODY_VARIABLE` / `GALLABOX_BASE_URL` default to `otp_login` / `otp` / `https://server.gallabox.com` |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | no | Meta sender, the fallback. **Leave every sender unset in development** — it falls back to a mock that logs the OTP instead of sending it. The chosen sender is logged at boot |
| `SUREPASS_TOKEN` | for credit checks | SurePass bearer token. Unset → every CIBIL check returns `PROVIDER_ERROR` with a friendly message; the boot log says so |
| `SUREPASS_BASE_URL` | no | Defaults to the sandbox host. **Going live is configuration only:** set this to the production host and `SUREPASS_TOKEN` to the production token, then redeploy |

---

## 5. Running it

```bash
npm install
npx prisma generate          # regenerate the typed client
npx prisma migrate deploy    # apply migrations to your database
npm run start:dev            # ts-node, http://localhost:3000/api/v1
```

| URL | What |
|---|---|
| `http://localhost:3000/api/v1/health` | Liveness probe |
| `http://localhost:3000/api-docs` | Swagger UI |

Build for production with `npm run build` (emits `dist/`), then `npm start`.

---

## 6. Current state

**Implemented — 21 endpoints:**

| Mount | Endpoints |
|---|---|
| `/auth` | `POST /register`, `POST /login`, `GET /status/:userId`, `POST /otp/request`, `POST /otp/verify`, `POST /password/reset`, `GET /me` |
| `/students/me` | `GET`, `GET /completion`, `GET /offers`, `PUT`, `PUT /financial`, `POST /submit` |
| `/students/me/documents` | `GET`, `POST`, `PUT /:id`, `GET /:id/preview`, `DELETE /:id` |
| `/admin` | `GET /registrations`, `PATCH /users/:userId/approval`, `GET /audit-log` |

**Not built yet:**

- **University module** — student discovery, filtering, shortlists
- **Bank module** — lender discovery, `bankEvaluationMode`, loan criteria
- **Offers module** — the org → student offer loop. `GET /students/me/offers`
  exists but nothing can populate it, because no organization-side endpoint
  creates an offer. **This is the single biggest functional gap.**
- **Reference data** — the ~1,400 universities, 279 programs and 50 countries
  the wizard's dropdowns need

**Known inconsistencies to resolve:**

1. `prisma/schema.prisma` still declares `CONSULTANT` in `Role` and
   `CONSULTANCY` in `OrganizationType`. The consultancy portal was deliberately
   removed from the product; these enum values should be dropped in a migration.
2. `docs/` was written against the earlier MongoDB design and still refers to
   collections and Mongoose schemas. The Prisma schema — not `docs/03` — is
   authoritative for the data model. The docs remain useful for business rules,
   API contracts and build order.
