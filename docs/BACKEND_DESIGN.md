# SuperOffer Backend — Design Derived from the Frontend

**Status:** Design only. Nothing here is built yet except the Step 1 foundation.
**Method:** Every table below was read out of the actual Angular code in
`superoffer-frontend/src/app`, not invented. File references are given so you can
verify any claim yourself.

---

## 0. The single most important finding

**The frontend has already decided the API contract.** `src/app/core/auth-api.service.ts`
(239 lines) is a complete list of every endpoint the Angular app calls, with exact
paths, HTTP methods, headers, and payload shapes.

This changes our job. We are not designing an API from scratch and hoping the
frontend fits — we are **implementing an API the frontend already expects**. If we
deviate, the frontend breaks.

So the rule for every later step: *check `auth-api.service.ts` first.*

The frontend calls a base URL of `/api/v1` (overridable at runtime via
`window.SUPER_OFFER_API_URL`), which matches the versioning already built in Step 1.

---

## 1. Who uses the system

The frontend has exactly **three** user-facing portals plus an admin console.

| Portal | Route prefix | Who |
|---|---|---|
| Student | `/student/*` | Students building a profile and receiving offers |
| Organization | `/organization/*` | Universities **and** banks (one shared workspace) |
| Admin | `/admin` | Super Admin approving organizations |

**A consultancy portal used to exist and was deliberately removed** (the merge you
did earlier). Do not build consultancy features. One leftover is noted in §9.

### Roles

From `src/app/core/organization.models.ts` and `auth-page.component.ts`:

```
STUDENT              -> student portal
UNIVERSITY_OFFICER   -> organization portal, organizationType = UNIVERSITY
LOAN_OFFICER         -> organization portal, organizationType = BANK
```

Note the shape: **universities and banks share one role-pair and one workspace
component** (`organization-workspace.component.ts`, 2432 lines), which switches
behaviour on `organizationType`. Your backend should mirror that: one
`organizations` collection with a `type` discriminator, not two collections.

---

## 2. Authentication — what the frontend actually does

### Endpoints it calls

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Email + password login |
| GET | `/auth/me` | Current user (Bearer token) |
| GET | `/auth/status/:userId` | Approval status polling |

### Register payloads differ by portal

Student (`auth-page.component.ts`):
```json
{ "email": "...", "password": "...", "role": "STUDENT" }
```

Organization:
```json
{ "email": "...", "password": "...", "role": "UNIVERSITY_OFFICER",
  "organizationName": "...", "organizationType": "UNIVERSITY",
  "phone": "...", "country": "..." }
```

### Login response shape the frontend destructures

```json
{ "accessToken": "...",
  "user": { "role": "...", "fullName": "...",
            "organization": { "name": "...", "organizationType": "UNIVERSITY" } } }
```

### Critical behaviours to preserve

1. **Students are NOT auto-logged-in after registering.** The frontend shows
   *"Account created. Please log in to continue."* and switches to the login form.
   (This was a deliberate commit on `main`.) So `/auth/register` for a student
   should **not** return a usable session.

2. **Organizations cannot log in until approved.** Registration returns a message
   like *"Your registration has been submitted for Super Admin review."*
   `/auth/login` must reject a `PENDING` or `REJECTED` organization.

3. **The token is a Bearer JWT** sent as `authorization: Bearer <token>`, stored
   by the frontend in `localStorage` (if "remember me") or `sessionStorage` under
   `superoffer_access_token`.

4. **401 means "session expired"** everywhere. Every student wizard step catches
   `status === 401`, clears the token, and redirects to login. So return a clean
   401 — never a 500 — for bad/expired tokens.

5. **`/auth/login` must return `organizationType`.** There is a localStorage
   workaround in `organization.models.ts` with this comment:

   > *"The backend does not yet expose a unified organization type on login, only
   > on registration... Remove once `/auth/login` returns organization type."*

   Returning it correctly lets us delete that hack.

**OTP is not implemented in the frontend today.** Every form is email + password.
Add OTP later as an additional flow; don't let it block Step 2.

---

## 3. The student profile — a 9-step wizard

Route shell: `student-portal-shell.component.ts`. Each step is its own component
that **saves to its own endpoint** before navigating to the next. The header of
step 1 literally reads `STEP 1 OF 9`.

Order (from the `router.navigateByUrl` chain in each component):

```
personal-information -> study-preferences -> academic-information
-> english-exam -> competitive-exam -> work-experience
-> financial-information -> projects -> review
```

Each step also supports `?from=review`, which returns the user to `/student/review`
instead of advancing — so **every section endpoint must work standalone**, in any
order, not just as a linear wizard.

### The section endpoints

All are `PUT`, all take `authorization: Bearer <token>`:

| Step | Endpoint | Payload keys (exact) |
|---|---|---|
| 1 | `/students/me/personal-information` | `fullName`, `email`, `mobileCountry`, `mobileNumber`, `altMobileCountry?`, `altMobileNumber?`, `country`, `city`, `phone`, `location` |
| 2 | `/students/me/study-preferences` | `countries[]`, `studyLevel[]`, `fieldOfInterest[]`, `startYear`, `intake[]` |
| 3 | `/students/me/academic-information` | `qualificationLevel`, `institution`, `score`, `graduationYear`, `qualification`, `educationGap?`, `history[]` |
| 4 | `/students/me/english-exam` | `englishExams[]`, `englishExam`, `englishScore` |
| 5 | `/students/me/competitive-exam` | `competitiveExams[]`, `entranceExam`, `entranceScore` |
| 6 | `/students/me/work-experience` | `workStatus`, `relevantYears`, `nonRelevantYears`, `experiences[]`, `companyName`, `jobRole` |
| 7 | `/students/me/financial-information` | `fundingSource`, `earningMembers[]`, `fatherIncome?`, `motherIncome?`, `guardianIncome?`, `annualHouseholdIncome`, `currency`, `employmentCategory`, `needsLoan`, `declarationAccurate`, `declarationConsent` |
| 8 | `/students/me/projects-achievements` | `projects[]`, `achievements[]`, `links[]`, `githubLink`, `linkedinLink`, `projectTitle`, `projectRole` |
| 9 | `POST /students/me/submit` | (no body) |

### Two derived-field patterns to replicate

The frontend computes some fields and sends **both** raw and derived values. Store both.

- **Academic:** `history[]` holds every qualification level the student selected
  (`{ level, institutionName, degreeName, specialization, cgpa, completionYear }`).
  The top-level `institution` / `score` / `graduationYear` / `qualification` are
  copied from the **highest** selected level, for cheap display and filtering.
- **Exams:** `englishExams[]` / `competitiveExams[]` are the full arrays; the
  singular `englishExam` + `englishScore` and `entranceExam` + `entranceScore`
  are the "primary" flattened values used by organization search filters.

This redundancy is intentional — organization discovery filters on the flat fields
(see §6), and denormalizing avoids scanning nested arrays on every search.

### Profile status

`review-profile.component.ts` sets `profileStatus = 'SUBMITTED'` and `submittedAt`
after a successful submit. Students only become visible to organizations once
submitted, so the student document needs at minimum:

```
status: 'DRAFT' | 'SUBMITTED'
submittedAt: Date
```

---

## 4. Reference data — 8 public endpoints

The frontend fetches every dropdown list from the backend. The doc comments say
it plainly:

> *"Public — no auth required. Single source of truth for ... dropdown data,
> matching the same lists the backend's own DTO validators check against."*

| Endpoint | Returns |
|---|---|
| `/reference/geo` | `countries[{name,iso2,dial}]`, `indiaCities[]` |
| `/reference/study-preferences` | `studyCountries[]`, `mbbsOnlyCountries[]`, `fieldsOfStudy[]`, `intakeOptions[]`, `startYears[]` |
| `/reference/academic-information` | `qualificationOptions[]`, `curriculumOptions[]`, `educationGapOptions[]`, `educationYears[]`, `universityOptions[]` |
| `/reference/english-exam` | `englishExamOptions[]`, `examStatusOptions[]` |
| `/reference/competitive-exam` | `competitiveExamOptions[]`, `examStatusOptions[]` |
| `/reference/work-experience` | `employmentTypes[]` |
| `/reference/financial-information` | `fundingSourceOptions[]`, `employmentCategoryOptions[]`, `earningMemberOptions[]`, `currencyOptions[]` |
| `/reference/projects-achievements` | `achievementSuggestions[]` |

**Design consequence:** the same constant arrays must back both the endpoint and
the validator. Define each list once in the backend, export it to the route and to
the validation schema. Never duplicate the list in two places — they will drift.

These are the **easiest possible Step 2**: no auth, no database writes, pure
read-only, and they immediately unblock the frontend's dropdowns.

---

## 5. Organizations — products, criteria, team, subscription

From `organization-workspace.component.ts`.

### Workspace views (each is a route)
```
dashboard, students, shortlists, invitations, catalog, templates,
criteria, reports, notifications, subscription, profile, settings
```

### University product (`interface Product`)
```
id, name, category?, degreeLevel: 'Undergraduate'|'Postgraduate', course, country,
intakes[], tuitionFee, scholarshipRange, durationYears, seats: number|'Rolling',
minCgpa?, englishTest?, minEnglishScore?, preferredCurricula?, targetCountries?,
templates[]?, url?, createdAt?, lastModifiedAt?, inviteNote?, templateName?
```

### Bank product (`interface LoanProduct`)
```
id, name, category?, interestRateMin, interestRateMax, currency, maxAmount,
tenureOptions[], collateralRequired, eligibleCountries[],
guarantorRequired?, maxFamilyIncome?, templates[]?, url?, createdAt?,
lastModifiedAt?, inviteNote?, templateName?
```

Same collection, discriminated by organization type — mirroring how one component
serves both.

### Other org-level entities
```
OfferTemplate     { id, name, description, terms, usedCount }
UniversityCriteria{ minCgpa, minEnglishScore, englishTest, preferredCurricula, targetCountries }
BankCriteria      { guarantorRequired, maxFamilyIncome, eligibleCountries }
TeamMember        { initials, name, email, role, status: 'Active'|'Invited', isSelf? }
```

`TeamMember.status === 'Invited'` implies a team-invitation flow (invite by email,
accept later). Not built in the frontend yet — note it, don't build it.

### Bank evaluation mode

```
BankEvaluationMode = 'ACADEMIC_ONLY' | 'UNIVERSITY_OFFER_ONLY' | 'ACADEMIC_AND_OFFER'
```

Currently persisted to `localStorage` under `superoffer_bank_evaluation_mode`. It
controls which students a bank can see (`passesVisibility`), so it is really an
**organization setting and a server-side access rule**, not a UI preference. It
should move to the organization document — and enforcement must be server-side,
since it governs data visibility.

---

## 6. Discovery — the filters that dictate your indexes

`filters` in `organization-workspace.component.ts` (line ~918). This is what the
student-search endpoint must support:

```
course, degree, country, intake, cgpaMin, budgetMin, scholarship,
englishTest, englishScoreMin, greMin, gmatMin, backlogsMax,
workExperienceMin, noVisaRefusals, familyIncomeMax, requiredLoanMax,
universityName, universityCourse, universityScholarship, offerStatus,
visibility: ''|'academicOnly'|'offerAvailable'
```

The searchable student shape is defined by `SubmittedStudent` in
`src/app/core/submitted-students.store.ts` — the clearest single description of
what a "discoverable student" looks like:

```
name, initials, photo, course, country, degree, cgpa, cgpaValue, ielts,
englishTest, englishScore, backlogs, workExperienceYears, visaRefused,
documentsVerified, examScore, budget, budgetValue, financialSummary, skills[],
score, factor, intake, scholarshipSeeking, bio, eligible, eligibilityNote,
submittedAt, gre?, gmat?, toefl?, familyIncome?, requiredLoanAmount?,
universityInterests[]?, needsLoan?, employmentCategory?, financialDocuments[]?
```

**Two things to notice.**

1. **Every numeric filter has a paired numeric field.** `cgpa` is display text
   (`"8.9 / 10"`); `cgpaValue` is the number (`8.9`) that filtering uses. Same for
   `budget`/`budgetValue`. Store both — do not parse strings at query time.

2. `mapProfileToOrgStudent()` in the same file is a complete, working
   profile → search-document transformation. **This is your projection logic,
   already written.** Port it to the backend rather than reinventing it.

**Suggested indexes** (from the filters above):
```
{ status: 1, country: 1, course: 1, intake: 1 }   // common combination
{ status: 1, cgpaValue: -1 }
{ status: 1, englishTest: 1, englishScore: -1 }
{ status: 1, budgetValue: -1 }
```
All compound on `status`, because only `SUBMITTED` students are ever discoverable.

---

## 7. Offers and invitations

Two views of the same object.

**Student side** — `StudentOffer` in `student-portal/offer-wallet.models.ts`:
```
id, category, institution, initial, logo?, program, headline, received, status,
location, intake, deadline, valueLabel, value, conditions, nextSteps[],
contact, contactRole, messages[], recommended?, viewed, compared, saved, favourite
+ category-specific fields:
  University   -> tuitionFee, scholarshipPct, durationYears, qsRanking, placementHighlights
  Bank         -> loanAmount, interestRate, emi, moratorium, processingFee, tenure
  Scholarship  -> amount, coverage, eligibility
```

**Organization side** — `interface Offer`:
```
student, initials, course, deadline, status, sent, sentAt?, responseHours?, ...
```

### Status vocabularies (three different ones — do not merge them)

```
OfferStatus (organization)     Sent|Viewed|Negotiating|Accepted|Rejected|Withdrawn|Expired
OfferDecisionStatus (student)  Pending|Shortlisted|Accepted|Rejected
UniversityOfferStatus (bank view of a student's university offers)
                               Offer Sent|Shortlisted|Selected|Admitted
JourneyStage (student tracker) Received|Viewed|Compared|Shortlisted|Accepted|Declined
```

That third one matters: a **bank** filters students by the status of their
**university** offers (`universityInterests[]`). So a student's university offers
are input to bank discovery — offers are cross-referenced between organization
types, not siloed.

### Messaging

Both sides carry an identical message thread:
```
{ from: 'institution' | 'student', author, body, time }
```
An offer is therefore also a conversation. Model messages as a subdocument array
initially; split into its own collection only if threads grow long.

---

## 8. Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/registrations?status=&org_type=` | `status`: PENDING/APPROVED/REJECTED/ALL |
| PATCH | `/admin/users/:userId/approval` | body: `approval_status`, `rejection_reason`, `approval_note` |
| GET | `/admin/audit-log?limit=100` | returns `{ entries: [] }` |

**Admin authenticates with an `x-admin-key` header — not a JWT.** A shared secret
from env, stored in `sessionStorage` as `superoffer_admin_key`. It works, but it
means anyone with the key is a full admin, with no identity in the audit log. See
Open Decision 3.

**Rejection reason is required when rejecting**; the approval note is optional.
The admin UI enforces this client-side — enforce it server-side too.

Response shape: `{ registrations: [...], summary: {...} }`, where each registration
uses `user_id`, `full_name`, `approval_status`, `rejection_reason`, `reviewed_at`.

---

## 9. Open decisions — resolve these before writing schemas

These are genuine ambiguities in the frontend. Each one changes the database design.

**1. `snake_case` vs `camelCase`.** The admin API uses `approval_status`,
`user_id`, `full_name`, `rejection_reason`, `reviewed_at`. Every other endpoint uses
`camelCase` (`fullName`, `accessToken`, `organizationType`). *Recommendation:*
camelCase everywhere, and update the admin component — it's one file, and mixed
conventions cause bugs forever.

**2. `/students/me/*` vs `/student/profile/*`.** Both exist in
`auth-api.service.ts`, seemingly for the same data. `/student/profile/documents`
is the only file-upload route. *Recommendation:* standardise on `/students/me/*`
(plural, RESTful) and keep documents at `/students/me/documents`.

**3. Admin auth = shared key.** Fine for launch, weak for a real startup: no
per-admin identity, no revocation, and the audit log can't say *who* approved.
*Recommendation:* ship the key now, plan a `SUPER_ADMIN` role with JWT next.

**4. `Consultancy` is still an offer category.** `OfferCategory` includes
`'Consultancy'` and the offer wallet has consultancy comparison fields, but the
consultancy portal was deleted — nothing can create one. *Decide:* drop it, or
keep it as an offer type without a portal.

**5. Who creates `Scholarship` offers?** It's a category with no portal either.
Probably a university offer variant rather than its own type.

**6. One `users` collection or several?** *Recommendation:* one `users` collection
(email, passwordHash, role, approvalStatus) plus separate `studentProfiles` and
`organizations` collections referencing it. Auth logic stays uniform; the very
different profile shapes stay clean.

**7. Where do uploaded documents live?** `uploadStudentDocument` posts multipart
`FormData`. Storing files in MongoDB is a bad default. *Recommendation:* object
storage (S3/Cloudinary), keeping only metadata in Mongo — `documentType`,
`fileName`, `mimeType`, `size`, `uploadedAt`, plus the storage key.

**8. Who computes `matchScore`?** The UI shows `94% AI MATCH`. Currently hardcoded
demo data. Server-computed (consistent, filterable) or client-computed (flexible)?
*Recommendation:* server-side, stored on the offer, since banks filter on it.

**9. `documentsVerified: 0..5`** implies exactly five verifiable documents and a
verification workflow with no UI yet. Which five, and who verifies?

**10. `visaRefused` is a discovery filter** but is collected nowhere in the
9-step wizard. Either add it to the wizard or drop the filter.

---

## 10. Proposed collections

```
users              _id, email (unique), passwordHash, role, approvalStatus,
                   rejectionReason, approvalNote, reviewedAt, createdAt

studentProfiles    userId (ref, unique), status: DRAFT|SUBMITTED, submittedAt,
                   personalInformation {}, studyPreferences {}, academicInformation {},
                   englishExam {}, competitiveExam {}, workExperience {},
                   financialInformation {}, projectsAchievements {},
                   searchFields {}   // the flat, indexed projection from §6

organizations      userId (ref), name, type: UNIVERSITY|BANK, country, phone,
                   criteria {}, bankEvaluationMode, team[], subscription {}

products           organizationId (ref), type: PROGRAM|LOAN, ...fields from §5

offers             organizationId, studentId, productId, category, status,
                   terms {}, messages[], deadline, createdAt

documents          studentId, documentType, fileName, mimeType, size,
                   storageKey, uploadedAt, verified

auditLog           actor, action, targetUserId, metadata, createdAt
```

---

## 11. Recommended build order

Each step is independently shippable and testable.

| Step | What | Why this order |
|---|---|---|
| **2** | Reference data endpoints (§4) | No auth, no writes, no schema decisions. Unblocks every frontend dropdown immediately. Lets us prove the routes/controllers/services pattern on something harmless. |
| **3** | `users` model + register/login + JWT + auth middleware | Everything below needs identity. |
| **4** | Organization registration + admin approval + audit log | Completes the login gate: orgs can't log in until approved. |
| **5** | Student profile: the 9 section endpoints + submit | The largest surface, but pure CRUD once auth exists. |
| **6** | Document upload | Needs the storage decision (Open Decision 7). |
| **7** | Products/catalog for organizations | |
| **8** | Student discovery + filters + indexes | Needs students to exist first. |
| **9** | Offers, invitations, messaging | The actual marketplace. |
| **10** | OTP login, dashboards/reporting, subscriptions | |

**Starting with Step 2 (reference data) is deliberate.** It is the only piece with
zero dependencies and zero unresolved questions, so it lets us validate the whole
architecture — routes → controllers → services → validators → response shape —
before any of the hard modelling decisions are locked in.

---

## 12. Sources

| Area | File |
|---|---|
| Full API contract | `core/auth-api.service.ts` |
| Roles, org types | `core/organization.models.ts` |
| Search projection | `core/submitted-students.store.ts` |
| Auth flows | `pages/auth/auth-page.component.ts` |
| Routes | `app.routes.ts` |
| Student wizard | `pages/student-portal/*.component.ts` |
| Profile persistence | `pages/student-portal/student-profile-ui.store.ts` |
| Offers | `pages/student-portal/offer-wallet.models.ts` |
| Financial docs | `pages/student-portal/financial-options.ts` |
| Organization workspace | `pages/organization-portal/organization-workspace.component.ts` |
| Admin | `pages/admin/admin-page.component.ts` |
