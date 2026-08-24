# SuperOffer Backend — API Documentation

**Stack:** NestJS · Prisma · PostgreSQL
**Base URL (local):** `http://localhost:3000/api/v1`
**Interactive docs:** `http://localhost:3000/api-docs` (Swagger UI, served by the running app)

All request/response examples below are taken from live test runs against a real Postgres database, not hand-written guesses.

---

## Authentication

**Every role signs in with email + password.** Institution roles
(`UNIVERSITY_OFFICER`, `LOAN_OFFICER`, `CONSULTANT`) are additionally gated behind Super Admin
approval; students can sign in as soon as they register.

The WhatsApp OTP endpoints below still exist and still work — they are the planned student
sign-in method once a WhatsApp API is available, but nothing uses them today.

Authenticated requests use `Authorization: Bearer <access_token>`.

### `POST /auth/register`
Registers a student, or an institution officer together with their organization.

Students send `role: "STUDENT"` and **omit** `organization`; they get `approval_status: "APPROVED"`
and can log in immediately. Institution roles must include `organization` and always start
`PENDING` — login is blocked until a Super Admin approves them.

```json
// Request — student
{
  "email": "aarav@example.com",
  "password": "Password123",
  "fullName": "Aarav Mehta",
  "role": "STUDENT"
}
```

```json
// Request — institution

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
| Unknown/invalid role | 400 | `INVALID_ROLE` |
| Institution role without organization details | 400 | `ORGANIZATION_REQUIRED` |
| Email already registered | 409 | `EMAIL_ALREADY_REGISTERED` |
| Phone already registered | 409 | `PHONE_ALREADY_REGISTERED` |
| Bad email/weak password | 400 | class-validator message |

### `POST /auth/login`
Password login for every role. `identifier` accepts an email (or a phone number).

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

### Wizard section endpoints

One endpoint per section of the nine-step wizard; each writes exactly one column of `student_profiles`. All are `PUT`, all take JSON, all return the updated profile.

| Path | Payload |
|---|---|
| `/students/me/personal-information` | `fullName`, `email`, `mobileCountry`, `mobileNumber`, `altMobileCountry?`, `altMobileNumber?`, `country`, `city`, `phone?`, `location?` |
| `/students/me/study-preferences` | `countries[]`, `studyLevel[]`, `fieldOfInterest[]`, `startYear[]`, `intake[]` |
| `/students/me/academic-information` | `qualificationLevel`, `history[]`, plus optional flat fields (recomputed server-side) |
| `/students/me/english-exam` | `englishExams[]` of `{exam, status, score?, expectedScore?, currentScore?}` |
| `/students/me/competitive-exam` | `competitiveExams[]`, same entry shape |
| `/students/me/work-experience` | `workStatus`, `relevantYears?`, `nonRelevantYears?`, `experiences[]` |
| `/students/me/financial-information` | `fundingSource`, `earningMembers[]`, per-earner incomes, `currency`, `employmentCategory`, `needsLoan`, both declarations |
| `/students/me/projects-achievements` | `projects[]`, `achievements[]`, `links[]` |

Every value validated against a fixed list is checked against **the same constants `/reference/*` serves**, so a student can never be offered an option the server rejects.

Rules enforced here rather than trusted from the client:

| Rule | Behaviour |
|---|---|
| Exam status decides required scores | `I have the score` needs `score`; `Awaiting Result`/`Yet to be taken` need `expectedScore`; `Retake` needs both current and expected → 400 otherwise |
| Income follows earning members | An income is required for each declared earner, and `annualHouseholdIncome` is recomputed from them |
| Both declarations must be true | 400 unless `declarationAccurate` and `declarationConsent` are both accepted |
| Highest qualification drives flat fields | `institution`, `score`, `graduationYear`, `qualification` derived from the last history entry |
| MBBS-only destinations force the study level | Selecting one rewrites `studyLevel` to `['MBBS']` |
| Work years only count when employed | Years and entries are cleared unless `workStatus` is `Yes` |

`POST /students/me/submit` refuses with `PROFILE_INCOMPLETE` (400) until `GET /students/me/completion` reports 100%.

---

## Reference data (public, no auth)

Eight `GET` endpoints under `/reference`, cached for a day. Data is generated from the SuperOffer master data sheet — see `src/reference/data/master-sheet.data.ts`.

| Path | Returns |
|---|---|
| `/reference/geo` | `countries[{name,iso2,dial}]` (200), `indiaCities[]` |
| `/reference/study-preferences` | `studyCountries[]` (50), `mbbsOnlyCountries[]` (22), `fieldsOfStudy[]` (279), `intakeOptions[]`, `startYears[]` |
| `/reference/academic-information` | `qualificationOptions[]`, `curriculumOptions[]`, `educationGapOptions[]`, `educationYears[]`, `universityOptions[]` (1,425) |
| `/reference/english-exam` | `englishExamOptions[]`, `examStatusOptions[]` |
| `/reference/competitive-exam` | `competitiveExamOptions[]`, `examStatusOptions[]` |
| `/reference/work-experience` | `employmentTypes[]` |
| `/reference/financial-information` | `fundingSourceOptions[]`, `employmentCategoryOptions[]`, `earningMemberOptions[]`, `currencyOptions[]`, `financialDocumentFields[]` |
| `/reference/projects-achievements` | `achievementSuggestions[]` |

---

## Offers

### Student side 🔒 (role: `STUDENT`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/students/me/offers` | Offers in the shape the wallet renders, plus `counts` |
| `POST` | `/students/me/offers/:id/view` | Marks viewed; advances the organization-side status to `VIEWED` |
| `PATCH` | `/students/me/offers/:id/flags` | `saved`, `favourite`, `compared` |
| `PATCH` | `/students/me/offers/:id/decision` | `Pending` \| `Shortlisted` \| `Accepted` \| `Rejected` |
| `POST` | `/students/me/offers/:id/messages` | A student reply moves the offer to `NEGOTIATING` |

### Organization side 🔒 (roles: `UNIVERSITY_OFFICER`, `LOAN_OFFICER`, `CONSULTANT`, organization must be `APPROVED`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/organizations/me/offers?status=` | Sent offers plus a status summary |
| `POST` | `/organizations/me/offers` | `studentUserId`, `category`, `program`, `headline`, `terms`, … `responseWindowDays?` (default 14) |
| `POST` | `/organizations/me/offers/:id/withdraw` | One-way, and only while the offer is open |
| `POST` | `/organizations/me/offers/:id/messages` | |

| Rule | Behaviour |
|---|---|
| 14-day auto-expiry | Offers past their window are marked `EXPIRED` on read |
| Terminal states are final | `ACCEPTED`/`REJECTED`/`WITHDRAWN`/`EXPIRED` reject further changes with `OFFER_CLOSED` |
| Only submitted students receive offers | `STUDENT_NOT_DISCOVERABLE` (400) otherwise |

---

## Organization discovery 🔒

| Method | Path | Notes |
|---|---|---|
| `GET` | `/organizations/me/profile` | The officer's organization and its verification status |
| `GET` | `/organizations/me/students` | Submitted profiles, projected into the workspace card shape |
| `GET` | `/organizations/me/students/:id` | One student |

Filters: `course`, `degree`, `country`, `intake`, `cgpaMin`, `englishTest`, `englishScoreMin`, `greMin`, `gmatMin`, `backlogsMax`, `workExperienceMin`, `scholarship`, `familyIncomeMax`, `requiredLoanMax`, `offerStatus`, `visibility` (bank-only), `search`.

Only `SUBMITTED` profiles are returned. Match score, household income and eligibility are computed server-side.

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

- **WhatsApp OTP is built but not in use.** `/auth/otp/request` and `/auth/otp/verify` work, backed by a mock sender that logs the code instead of messaging a phone. A production `MetaWhatsAppSender` is implemented and wired — switching is just setting `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`. To make it the student sign-in method again, point the frontend auth page at those two endpoints; the backend needs no change. Swapping to an email-based OTP would mean adding an `EmailSender` alongside the existing `WhatsAppSender` interface.
- Discovery filtering runs in memory over submitted profiles, because the profile lives in JSON columns. Move the hot filters into SQL (or a projection table) once the student count outgrows a page of results.
- Offer expiry is applied lazily on read. A scheduled job would be better once one exists.
- Not yet built: notifications, subscriptions/billing, reports & analytics beyond the workspace's own aggregates, and the AI-matching service. The organization workspace renders these from local demo data today.
