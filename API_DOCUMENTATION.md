# SuperOffer Backend — API Documentation

**Stack:** NestJS · Prisma · PostgreSQL
**Base URL (local):** `http://localhost:3000/api/v1`
**Interactive docs:** `http://localhost:3000/api-docs` (Swagger UI, served by the running app)

All request/response examples below are taken from live test runs against a real Postgres database, not hand-written guesses.

---

## Authentication

Two separate login mechanisms by role:
- **Institution roles** (`UNIVERSITY_OFFICER`, `LOAN_OFFICER`, `CONSULTANT`) — email + password, gated behind Super Admin approval.
- **`STUDENT`** — phone number + WhatsApp OTP, no password. Registering/logging in with a password is rejected for this role.

Authenticated requests use `Authorization: Bearer <access_token>`.

### `POST /auth/register`
Registers an institution officer and their organization. Always starts `PENDING` — login is blocked until a Super Admin approves it.

```json
// Request
{
  "email": "uni.officer@northbridge.edu",
  "password": "password123",
  "phone": "+14165550001",
  "fullName": "Maya Chen",
  "role": "UNIVERSITY_OFFICER",
  "organization": {
    "name": "Northbridge University",
    "registrationNumber": "CA-UNI-1984",
    "country": "Canada",
    "city": "Toronto"
  }
}
```
```json
// 201 Created
{
  "user_id": "9d76bd94-a5a8-4b4e-93f8-a6785226c707",
  "role": "UNIVERSITY_OFFICER",
  "approval_status": "PENDING",
  "can_login": false
}
```

`role` accepts `UNIVERSITY_OFFICER`, `LOAN_OFFICER`, or `CONSULTANT`. It determines the organization's type automatically (`UNIVERSITY`, `BANK`, `CONSULTANCY` respectively).

| Error | Status | Code |
|---|---|---|
| Role is `STUDENT` | 400 | `STUDENT_USES_OTP_LOGIN` |
| Unknown/invalid role | 400 | `INVALID_ROLE` |
| Email already registered | 409 | `EMAIL_ALREADY_REGISTERED` |
| Phone already registered | 409 | `PHONE_ALREADY_REGISTERED` |
| Bad email/weak password | 400 | class-validator message |

### `POST /auth/login`
Password login for institution roles. `identifier` accepts email (or phone, for completeness).

```json
// Request
{ "identifier": "uni.officer@northbridge.edu", "password": "password123" }
```
```json
// 200 OK
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600,
  "role": "UNIVERSITY_OFFICER",
  "full_name": "Maya Chen",
  "organization": {
    "name": "Northbridge University",
    "organizationType": "UNIVERSITY",
    "registrationNumber": "CA-UNI-1984",
    "licenseReference": null,
    "website": null,
    "country": "Canada",
    "city": "Toronto"
  },
  "mfa_required": false,
  "email_verified": false,
  "phone_verified": false
}
```

| Error | Status | Code |
|---|---|---|
| Student tries password login | 400 | `STUDENT_USES_OTP_LOGIN` |
| Wrong email/password | 401 | `INVALID_CREDENTIALS` |
| 5 failed attempts in a row | 423 | `ACCOUNT_LOCKED` (`retry_after_seconds` in body, 900s lock) |
| Organization still pending | 403 | `ACCOUNT_PENDING_APPROVAL` |
| Organization rejected | 403 | `ACCOUNT_REJECTED` (includes the reviewer's reason) |

Failed-attempt counters and lockouts are persisted in Postgres on the `users` row — they survive a server restart.

### `POST /auth/otp/request`
Student login/registration, step 1. Creates the student account on first use. Sends a 6-digit code over WhatsApp (mock sender in development — the code is logged to the server console instead of being delivered).

```json
// Request
{ "phone": "+919876543210", "fullName": "Priya Nair" }
```
```json
// 200 OK
{ "user_id": "5759e3dd-dd9b-4c84-af5f-dcd32223edac", "phone": "+919876543210", "otp_sent": true, "expires_in_seconds": 300 }
```

| Error | Status | Code |
|---|---|---|
| Malformed phone number | 400 | `VALIDATION_ERROR` |
| Phone belongs to a non-student account | 409 | `PHONE_ALREADY_REGISTERED` |
| Requested again inside the cooldown window | 429 | `OTP_ALREADY_SENT` (`retry_after_seconds`, 30s cooldown) |

### `POST /auth/otp/verify`
Student login/registration, step 2. On success, issues the same token pair as password login.

```json
// Request
{ "phone": "+919876543210", "code": "344035" }
```
```json
// 200 OK
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600,
  "role": "STUDENT",
  "full_name": "Priya Nair",
  "organization": null,
  "mfa_required": false,
  "email_verified": false,
  "phone_verified": true
}
```

| Error | Status | Code |
|---|---|---|
| No OTP on file / already used | 400 | `OTP_INVALID` |
| Code expired (5 min TTL) | 400 | `OTP_EXPIRED` |
| Wrong code | 400 | `OTP_INVALID` (invalidated entirely after 5 wrong attempts) |
| No account for this phone | 404 | `USER_NOT_FOUND` |

### `GET /auth/status/:userId`
Public registration-status lookup (e.g. for a "your application is under review" page).

```json
// 200 OK
{
  "user_id": "9d76bd94-a5a8-4b4e-93f8-a6785226c707",
  "role": "UNIVERSITY_OFFICER",
  "approval_status": "APPROVED",
  "can_login": true,
  "organization_name": "Northbridge University",
  "rejection_reason": null,
  "submitted_at": "2026-08-07T15:03:54.712Z",
  "reviewed_at": "2026-08-07T15:03:55.969Z"
}
```

### `GET /auth/me` 🔒
Returns the signed-in user's own profile. Requires a valid access token.

```json
// 200 OK
{
  "user_id": "9d76bd94-a5a8-4b4e-93f8-a6785226c707",
  "email": "uni.officer@northbridge.edu",
  "phone": "+14165550001",
  "full_name": "Maya Chen",
  "role": "UNIVERSITY_OFFICER",
  "approval_status": "APPROVED",
  "organization": { "name": "Northbridge University", "organizationType": "UNIVERSITY" }
}
```

---

## Admin

All endpoints require header `x-admin-key: <ADMIN_APPROVAL_KEY>` — not a user login, a shared operations key (matches how the admin panel authenticates).

### `GET /admin/registrations?status=PENDING&org_type=ALL`
`status`: `PENDING` | `APPROVED` | `REJECTED` | `ALL`. `org_type`: `UNIVERSITY` | `BANK` | `CONSULTANCY` | `ALL`.

```json
// 200 OK
{
  "summary": { "pending": 4, "approved": 0, "rejected": 0, "universities": 4, "banks": 0, "consultancies": 0 },
  "registrations": [
    {
      "user_id": "9d76bd94-a5a8-4b4e-93f8-a6785226c707",
      "full_name": "Maya Chen",
      "email": "uni.officer@northbridge.edu",
      "phone": "+14165550001",
      "role": "UNIVERSITY_OFFICER",
      "approval_status": "PENDING",
      "organization": { "name": "Northbridge University", "organizationType": "UNIVERSITY", "registrationNumber": "CA-UNI-1984", "licenseReference": null, "website": null, "country": "Canada", "city": "Toronto" },
      "submitted_at": "2026-08-07T15:03:54.712Z",
      "reviewed_at": null,
      "rejection_reason": null
    }
  ]
}
```
`summary` always reflects every organization regardless of the active filter, so metric tiles don't jump around as you filter the list.

### `PATCH /admin/users/:userId/approval`
```json
// Request
{ "approval_status": "APPROVED", "approval_note": "Verified via registrar site" }
// or: { "approval_status": "REJECTED", "rejection_reason": "Registration number could not be verified" }
```
```json
// 200 OK
{ "user_id": "9d76bd94-a5a8-4b4e-93f8-a6785226c707", "approval_status": "APPROVED", "can_login": true, "reviewed_at": "2026-08-07T15:03:55.969Z" }
```
Writes an entry to the audit log every time.

### `GET /admin/audit-log?limit=100`
```json
// 200 OK
{
  "entries": [
    {
      "id": "5d17f5a9-a590-4a97-96cb-92c43f4b4e47",
      "action": "ORGANIZATION_APPROVED",
      "organizationName": "Northbridge University",
      "entityId": "c70626c7-5d3c-45f1-95dd-b9477ac2442a",
      "actorUserId": "SUPER_ADMIN",
      "reason": "Verified via registrar site",
      "occurredAt": "2026-08-07T15:03:55.970Z"
    }
  ]
}
```

---

## Student Profile 🔒 (role: `STUDENT`)

The profile is stored as JSON sections whose keys match the onboarding wizard's form groups exactly: `basic`, `studyLevel`, `academic`, `preferences`, `selectedTests`, `testDetails`, `achievements`, `financial`, `links`.

### `GET /students/me`
Returns the full profile plus an embedded `documents` array. Auto-creates an empty profile on first call.

### `PUT /students/me`
Merges everything **except** `financial` (which has its own endpoint, matching how the onboarding wizard saves it separately).
```json
// Request
{
  "basic": { "firstName": "Priya", "lastName": "Nair", "email": "priya.nair@example.com", "mobile": "9812345678", "dateOfBirth": "2003-05-10", "country": "India" },
  "studyLevel": "UG",
  "academic": { "schoolName": "Delhi Public School", "board": "CBSE", "currentGrade": "Completed Grade 12", "tenthScore": "92%", "twelfthScore": "90%", "passingYear": "2027" },
  "preferences": { "course": "Computer Science", "countries": ["United Kingdom", "Canada"], "intake": ["Fall 2027"] },
  "selectedTests": ["IELTS"],
  "testDetails": { "IELTS": { "score": "7.5", "date": "2026-06-01" } },
  "achievements": { "selected": ["Coding", "Hackathons"], "story": "Built an app for my school" },
  "links": { "linkedin": "linkedin.com/in/priyanair" }
}
```
Returns the full updated profile (200 OK).

### `PUT /students/me/financial`
```json
// Request
{ "fundingPreference": "Education Loan", "estimatedAnnualBudget": "USD 20,000–30,000", "interestedInScholarships": true, "preferLowerTuition": false, "needFinancialAssistance": true }
```

### `GET /students/me/completion`
```json
// 200 OK
{
  "completionPercent": 100,
  "status": "DRAFT",
  "sections": [
    { "key": "basicInformation", "label": "Basic Information", "done": true },
    { "key": "studyPreferences", "label": "Study Preferences", "done": true },
    { "key": "academicInformation", "label": "Academic Information", "done": true },
    { "key": "testsCompleted", "label": "Tests Completed", "done": true },
    { "key": "documentsUploaded", "label": "Documents", "done": true },
    { "key": "financialInformation", "label": "Financial Information", "done": true }
  ],
  "missing": []
}
```
`documentsUploaded` checks that every study-level-specific *required document type* has actually been uploaded — not just a document count.

### `POST /students/me/submit`
Marks the profile `SUBMITTED` and stamps `submittedAt`. 200 OK, returns the full profile.

### `GET /students/me/offers`
Stub for forward compatibility with the frontend — always `{ "results": [], "total_results": 0 }` today (no Invitations/Offers module built yet).

---

## Student Documents 🔒 (role: `STUDENT`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/students/me/documents` | List, newest first |
| `POST` | `/students/me/documents` | Multipart: `file` + `documentType`. Max 10MB. |
| `PUT` | `/students/me/documents/:id` | Multipart `file` — replaces content, keeps the same document row |
| `GET` | `/students/me/documents/:id/preview` | Streams the file inline (`Content-Disposition: inline`) for the frontend to fetch-as-blob |
| `DELETE` | `/students/me/documents/:id` | Deletes the DB row and the file on disk |

All document endpoints verify the document belongs to the requesting student (`403 Forbidden` otherwise, `404` if it doesn't exist).

---

## Health

- `GET /health` and `GET /` — `{ "status": "ok", "service": "superoffer-backend", "version": "2.0.0" }`

---

## Notes for the next phase

- WhatsApp OTP delivery is currently a **mock sender** (logs the code, doesn't message a real phone). A production `MetaWhatsAppSender` is already implemented and wired — switching is just setting `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` in the environment. Swapping to an email-based OTP later would mean adding an `EmailSender` alongside the existing `WhatsAppSender` interface — no changes needed to the OTP request/verify logic itself.
- Not yet built: University/Loan/Consultant search, Invitations & Offers, Notifications, Subscriptions/Billing, Reports/Analytics, AI Matching, Settings. The current frontend doesn't render UI for most of these yet either.
