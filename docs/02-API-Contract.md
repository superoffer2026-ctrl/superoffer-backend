# 02 — API Contract

Every endpoint the frontend calls. Source: `core/auth-api.service.ts` +
`core/student-profile-api.service.ts`.

Base URL `/api/v1` (frontend override: `window.SUPER_OFFER_API_URL`).
Timeout: **15 seconds** — the frontend aborts after that.

## Global rules

**Auth header:** `authorization: Bearer <token>`

**Success shape** (already implemented in `utils/apiResponse.js`):
```json
{ "success": true, "message": "...", "data": { } }
```

**Error shape** (already implemented in `middleware/error.middleware.js`):
```json
{ "success": false, "message": "..." }
```

The frontend reads `body.message` for the text it displays, and also reads
`body.code` and `error.status`. So:

- Always return JSON, never plain text — the frontend falls back to the generic
  *"The request could not be completed"* when it can't parse a body.
- **401 must mean "token invalid or expired" and nothing else.** Every wizard step
  treats 401 as "session expired": it deletes the token and redirects to login.
  Never return 401 for a validation failure — use 400.

---

## Auth

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register` | none |
| POST | `/auth/login` | none |
| GET | `/auth/me` | Bearer |
| GET | `/auth/status/:userId` | none |

### POST /auth/register — student
```json
{ "email": "...", "password": "...", "role": "STUDENT" }
```
Returns a success message. **Must not return a usable session** — the frontend
shows *"Account created. Please log in to continue."* and switches to the login form.

### POST /auth/register — organization
```json
{ "email": "...", "password": "...", "role": "UNIVERSITY_OFFICER",
  "organizationName": "...", "organizationType": "UNIVERSITY",
  "phone": "...", "country": "..." }
```
Creates the account with `approvalStatus = PENDING`. Response `message` is displayed
verbatim; default if absent: *"Your registration has been submitted for Super Admin
review. You can log in once it is approved."*

### POST /auth/login
```json
{ "email": "...", "password": "..." }
```
Response — these exact paths are destructured by `auth-page.component.ts`:
```json
{ "accessToken": "<jwt>",
  "user": {
    "role": "UNIVERSITY_OFFICER",
    "fullName": "...",
    "organization": { "name": "...", "organizationType": "UNIVERSITY" }
  } }
```

Rules:
- Reject a `PENDING` or `REJECTED` organization with a clear message.
- **`user.organization.organizationType` must be present.** A localStorage
  workaround exists purely because it isn't; returning it lets that be deleted.
- For students, `user.organization` is null.

---

## Student profile

All `PUT` unless noted. All Bearer. Payload keys are exact — see
[04-Student-Profile-Module.md](04-Student-Profile-Module.md) for field detail.

| Method | Path | Body keys |
|---|---|---|
| GET | `/students/me` | — (returns the whole profile, shape below) |
| PUT | `/students/me` | full profile object |
| PUT | `/students/me/personal-information` | `fullName`, `email`, `mobileCountry`, `mobileNumber`, `altMobileCountry?`, `altMobileNumber?`, `country`, `city`, `phone`, `location` |
| PUT | `/students/me/study-preferences` | `countries[]`, `studyLevel[]`, `fieldOfInterest[]`, `startYear[]`, `intake[]` |
| PUT | `/students/me/academic-information` | `qualificationLevel`, `institution`, `score`, `graduationYear`, `qualification`, `educationGap?`, `history[]` |
| PUT | `/students/me/english-exam` | `englishExams[]`, `englishExam`, `englishScore` |
| PUT | `/students/me/competitive-exam` | `competitiveExams[]`, `entranceExam`, `entranceScore` |
| PUT | `/students/me/work-experience` | `workStatus`, `relevantYears`, `nonRelevantYears`, `experiences[]`, `companyName`, `jobRole` |
| PUT | `/students/me/financial-information` | `fundingSource`, `earningMembers[]`, `fatherIncome?`, `motherIncome?`, `guardianIncome?`, `annualHouseholdIncome`, `currency`, `employmentCategory`, `needsLoan`, `declarationAccurate`, `declarationConsent` |
| PUT | `/students/me/projects-achievements` | `projects[]`, `achievements[]`, `links[]`, `githubLink`, `linkedinLink`, `projectTitle`, `projectRole` |
| POST | `/students/me/submit` | (no body) |
| GET | `/students/me/offers` | — |

### GET /students/me — response shape

**This is the most easily-got-wrong contract in the system.** Nine different
components read this response, and the section keys do **not** match the section
endpoint names. Verified by reading every consumer:

```json
{
  "personal":        { "fullName": "...", "email": "...", "mobileCountry": "...",
                       "mobileNumber": "...", "country": "...", "city": "...", "...": "..." },
  "studyPreferences":{ "countries": [], "studyLevel": [], "fieldOfInterest": [],
                       "startYear": [], "intake": [] },
  "academic":        { "history": [ { "level": "...", "...": "..." } ], "educationGap": "..." },
  "entranceExams":   { "englishExams": [], "competitiveExams": [] },
  "workExperience":  { "workStatus": "...", "relevantYears": "...",
                       "nonRelevantYears": "...", "experiences": [] },
  "financial":       { "fundingSource": "...", "...": "..." },
  "projects":        { "projects": [], "achievements": [], "links": [] },
  "documents":       [ { "id": "...", "documentType": "...", "fileName": "...",
                         "mimeType": "...", "size": 0, "uploadedAt": "..." } ]
}
```

Note the mismatches, which are **required**, not typos:

| Saved via | Read back as |
|---|---|
| `/personal-information` | `personal` |
| `/academic-information` | `academic` |
| `/english-exam` **and** `/competitive-exam` | `entranceExams` (one shared object) |
| `/financial-information` | `financial` |
| `/projects-achievements` | `projects` |
| `/study-preferences` | `studyPreferences` ✓ matches |
| `/work-experience` | `workExperience` ✓ matches |

`entranceExams` is the one to watch: two separate endpoints write into **one**
response object, `{ englishExams: [], competitiveExams: [] }`.

**Legacy keys.** Older components (`student-profile-ui.store.ts`,
`pages/portal/student-profile-onboarding.component.ts`) additionally read
`basic`, `preferences`, `tests`, `skills`, `achievements`, `studyLevel`. These
duplicate the keys above. Recommendation: implement the seven canonical keys, and
treat any screen that breaks as a frontend cleanup task.

---

## Documents

| Method | Path | Notes |
|---|---|---|
| POST | `/student/profile/documents` | `multipart/form-data`: `documentType`, `file` |
| — | replace | frontend calls a replace with an existing document id |
| — | delete | by document id |

Response per document:
```json
{ "id": "...", "documentType": "...", "fileName": "...",
  "mimeType": "...", "size": 12345, "uploadedAt": "ISO-8601" }
```

`documentType` is a **human-readable label**, not an enum — e.g.
`"10th Mark Sheet"`, `"Undergraduate Transcript / Consolidated Mark Sheet"`. The
list varies by study level; see [04](04-Student-Profile-Module.md).

Do **not** set `content-type: application/json` on this route — the frontend
deliberately omits it so the browser can set the multipart boundary.

---

## Alternate profile paths (duplicate surface)

`auth-api.service.ts` also declares these, overlapping the above:

| Method | Path |
|---|---|
| GET | `/student/profile` |
| PUT | `/student/profile/:section` |

See Open Decision 2 — standardise on `/students/me/*` and retire these.

---

## Reference data (public, no auth)

| Path | Returns |
|---|---|
| `/reference/geo` | `countries[{name,iso2,dial}]`, `indiaCities[]` |
| `/reference/study-preferences` | `studyCountries[]`, `mbbsOnlyCountries[]`, `fieldsOfStudy[]`, `intakeOptions[]`, `startYears[]` |
| `/reference/academic-information` | `qualificationOptions[]`, `curriculumOptions[]`, `educationGapOptions[]`, `educationYears[]`, `universityOptions[]` |
| `/reference/english-exam` | `englishExamOptions[]`, `examStatusOptions[]` |
| `/reference/competitive-exam` | `competitiveExamOptions[]`, `examStatusOptions[]` |
| `/reference/work-experience` | `employmentTypes[]` |
| `/reference/financial-information` | `fundingSourceOptions[]`, `employmentCategoryOptions[]`, `earningMemberOptions[]`, `currencyOptions[]` |
| `/reference/projects-achievements` | `achievementSuggestions[]` |

Full detail in [08-Reference-Data.md](08-Reference-Data.md).

---

## Admin

Authenticated by header `x-admin-key: <secret>` — **not** a Bearer token.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/registrations?status=&org_type=` | `status`: `PENDING\|APPROVED\|REJECTED\|ALL`; `org_type`: `ALL\|UNIVERSITY\|BANK` |
| PATCH | `/admin/users/:userId/approval` | body: `approval_status`, `rejection_reason`, `approval_note` |
| GET | `/admin/audit-log?limit=100` | |

⚠️ **These use `snake_case`** while every other endpoint uses `camelCase`.
See Open Decision 1.

Response shapes in [07-Admin-Module.md](07-Admin-Module.md).

---

## Not yet called by the frontend

The organization workspace runs entirely on hardcoded demo data — it makes **no**
API calls today. So organization endpoints (products, discovery, offers,
shortlists, team, subscription) have **no fixed contract yet**. You are free to
design them, using [05](05-Organization-Module.md) and [06](06-Offers-Module.md)
for the required shapes. Wiring the frontend to them is a separate task.
