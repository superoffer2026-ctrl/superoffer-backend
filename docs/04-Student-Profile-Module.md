# 04 — Student Profile Module

The largest module: a 9-step wizard, each step saving independently.
Source: `pages/student-portal/*.component.ts`.

## Wizard order

Step 1's header literally reads `STEP 1 OF 9`. Navigation chain from each
component's `router.navigateByUrl`:

```
1 personal-information -> 2 study-preferences -> 3 academic-information
-> 4 english-exam -> 5 competitive-exam -> 6 work-experience
-> 7 financial-information -> 8 projects -> 9 review -> submit
```

Every step supports `?from=review`, returning to `/student/review` instead of
advancing. **Consequence: every section endpoint must work standalone, in any
order, any number of times.** Treat each as an idempotent upsert of one subdocument.

Every step, on load: no token → redirect to login; on any 401 → clear token and
redirect with `?sessionExpired=1`.

---

## Step 1 — Personal Information

`PUT /students/me/personal-information` → stored as `personal`

| Field | Required | Notes |
|---|---|---|
| **fullName** | ✅ | non-empty |
| **email** | ✅ | regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| **mobileCountry** | ✅ | ISO2 code, e.g. `IN` |
| **mobileNumber** | ✅ | digits only after stripping non-digits: `/^\d{6,14}$/` |
| altMobileCountry | | required only if `altMobileNumber` present |
| altMobileNumber | | same digit rule when present |
| **country** | ✅ | **must exactly match a country name** from `/reference/geo` |
| **city** | ✅ | from `indiaCities[]` when available for that country, else free text |
| phone | derived | `"<dial> <mobileNumber>"`, e.g. `"+91 98765 43210"` |
| location | derived | `"<city>, <country>"` |

Changing `country` clears `city` in the UI. Validate `country` server-side against
the same list the reference endpoint serves.

---

## Step 2 — Study Preferences

`PUT /students/me/study-preferences` → stored as `studyPreferences`

All five are **arrays**, all require **at least one** entry (`requireOne` validator):

| Payload key | Form control | Source list |
|---|---|---|
| **countries** | `countries` | `studyCountries` |
| **studyLevel** | `fieldsOfStudy` | `fieldsOfStudy` |
| **fieldOfInterest** | `programs` | `fieldsOfStudy` (same list) |
| **startYear** | `startYear` | `startYears` |
| **intake** | `intakes` | `intakeOptions` |

⚠️ Note the deliberate cross-naming: form `fieldsOfStudy` → payload `studyLevel`,
and form `programs` → payload `fieldOfInterest`. Do not "fix" this.

### Business rule — MBBS-only countries

If any selected country appears in `mbbsOnlyCountries`, the study-level list
collapses to `['MBBS']`, previously-selected levels are dropped, and `MBBS` is
auto-added. Enforce server-side: reject a payload combining an MBBS-only country
with a non-MBBS study level.

---

## Step 3 — Academic Information

`PUT /students/me/academic-information` → stored as `academic`

The student ticks one or more qualification levels; **each ticked level makes all
of its fields required**. At least one level must be selected.

Levels come from `/reference/academic-information` → `qualificationOptions`.
Observed set: `11th`, `12th`, `Diploma`, `Bachelor's Degree`, `Master's Degree`, `PhD`.

### Fields per level

| Level | Fields |
|---|---|
| 11th, 12th | `curriculum`, `cgpa`, `startedYear`, `completionYear` |
| Diploma | `institutionName`, `specialization`, `cgpa`, `backlogs`, `startedYear`, `completionYear` |
| Bachelor's | `degreeName`, `specialization`, `institutionName`, `cgpa`, `backlogs`, `startedYear`, `completionYear`, `yearsOfEducation` |
| Master's | `degreeName`, `specialization`, `institutionName`, `cgpa`, `backlogs`, `startedYear`, `completionYear`, `yearsOfEducation` |
| PhD | `degreeName` , `specialization` (labelled "Research Area"), `institutionName`, `cgpa`, `backlogs`, `startedYear`, `completionYear`, `yearsOfEducation` |

`cgpa` is free text — `"8.7 CGPA"` or `"85%"` both valid. `institutionName` for
degree levels is a select over `universityOptions` but **allows custom values**.

### Payload

```json
{ "qualificationLevel": "Master's Degree",
  "institution": "...", "score": "...", "graduationYear": "...",
  "qualification": "M.Tech Data Science",
  "educationGap": "...",
  "history": [ { "level": "Bachelor's Degree", "degreeName": "...", "...": "..." } ] }
```

`history[]` holds every selected level. The five flat fields are **derived from the
highest selected level**:

- `institution` ← highest level's `institutionName`
- `score` ← highest level's `cgpa`
- `graduationYear` ← highest level's `completionYear`
- `qualification` ← `"<degreeName> <specialization>"`, else the level name
- `qualificationLevel` ← the highest level itself

"Highest" = last in the reference list order. Store both; the flat fields power
organization search filters.

---

## Steps 4 & 5 — Exams

Two endpoints, **one** stored object `entranceExams`:

```
PUT /students/me/english-exam      -> entranceExams.englishExams[]
PUT /students/me/competitive-exam  -> entranceExams.competitiveExams[]
```

Both steps share an identical structure.

### Payloads
```json
// english-exam
{ "englishExams": [ {...} ], "englishExam": "IELTS", "englishScore": "7.5" }
// competitive-exam
{ "competitiveExams": [ {...} ], "entranceExam": "GRE", "entranceScore": "323" }
```

The singular fields are the **first** entry of the array, flattened for search:
`exam` name, and score taken as `score || expectedScore || currentScore`.

### Exam entry shape
```json
{ "exam": "IELTS", "status": "...", "score": "", "expectedScore": "", "currentScore": "" }
```

### Conditional score validation (`exam-options.ts`)

`status` is always required. Which score fields are required depends on it:

| status | Required score fields |
|---|---|
| `I have the score` | `score` |
| `Awaiting Result` | `expectedScore` |
| `Yet to be taken` | `expectedScore` |
| `Retake` | `currentScore` **and** `expectedScore` |

Non-applicable score fields are cleared. Replicate this exactly in the validator —
it is the trickiest validation rule in the module.

### The "attended exams" gate
A `Yes`/`No` control precedes the list. Setting it to anything but `Yes` **clears
the whole array**. So an empty array is a valid, meaningful state ("no exams taken"),
not a missing value.

---

## Step 6 — Work Experience

`PUT /students/me/work-experience` → stored as `workExperience`

```json
{ "workStatus": "Yes", "relevantYears": "2", "nonRelevantYears": "1",
  "experiences": [ { "companyName": "...", "role": "...", "type": "...",
                     "durationMonths": "6", "description": "" } ],
  "companyName": "...", "jobRole": "..." }
```

- **workStatus** required (`Yes` / `No`).
- If `workStatus === 'Yes'`: **relevantYears** and **nonRelevantYears** become
  required, and at least one experience row exists.
- If not `Yes`: both year fields are cleared and validators removed.
- Per experience row: **companyName**, **role**, **type**, **durationMonths**
  required; `description` optional.
- `type` comes from `/reference/work-experience` → `employmentTypes`.
- Top-level `companyName` / `jobRole` are the flattened first experience.

---

## Step 7 — Financial Information

`PUT /students/me/financial-information` → stored as `financial`

```json
{ "fundingSource": "...", "earningMembers": ["Father","Mother"],
  "fatherIncome": "...", "motherIncome": "...", "guardianIncome": "...",
  "annualHouseholdIncome": "1800000", "currency": "INR",
  "employmentCategory": "Salaried", "needsLoan": "yes",
  "declarationAccurate": true, "declarationConsent": true }
```

| Field | Rule |
|---|---|
| **fundingSource** | required — from `fundingSourceOptions` |
| **earningMembers** | array, at least one — from `earningMemberOptions` |
| **currency** | required — from `currencyOptions` |
| **employmentCategory** | required — from `employmentCategoryOptions` |
| **needsLoan** | required — `'yes'` / `'no'` |
| **declarationAccurate** | must be **true** (`Validators.requiredTrue`) |
| **declarationConsent** | must be **true** |
| income fields | conditionally required, see below |

### Conditional income fields
```
Father   -> fatherIncome required
Mother   -> motherIncome required
Guardian -> guardianIncome required
```
Only the incomes for selected earning members are required.

`annualHouseholdIncome` is **computed** — the sum of the provided incomes — and sent
as a string. Recompute it server-side rather than trusting the client.

Both declaration booleans must be true; treat this as legal consent and store a
timestamp alongside.

---

## Step 8 — Projects & Achievements

`PUT /students/me/projects-achievements` → stored as `projects`

```json
{ "projects": [ { "title": "...", "role": "...", "description": "" } ],
  "achievements": ["..."], "links": ["..."],
  "githubLink": "...", "linkedinLink": "...",
  "projectTitle": "...", "projectRole": "..." }
```

Per project: **title** and **role** required, `description` optional.
`achievements[]` and `links[]` are plain string arrays.
`projectTitle` / `projectRole` are the flattened first project.
`achievementSuggestions` from reference data is autocomplete only — custom values allowed.

---

## Step 9 — Review & Submit

`POST /students/me/submit` (no body)

On success the frontend sets `profileStatus = 'SUBMITTED'` and `submittedAt`, then
redirects to the dashboard.

Server-side this must:
1. Validate that all required sections are complete.
2. Set `status = 'SUBMITTED'`, `submittedAt = now`.
3. Build the search projection (see [05](05-Organization-Module.md)) so the student
   becomes discoverable.

Submitting twice should be safe.

---

## Documents

Separate from the wizard, used in `/student/onboarding`.
`POST /student/profile/documents` — multipart `documentType` + `file`.

**`documentType` is a display label, and the required list depends on study level:**

| Study level | Required |
|---|---|
| UG | `10th Mark Sheet`, `12th Mark Sheet / Latest Marks` |
| PG | `10th Mark Sheet`, `12th Mark Sheet`, `Undergraduate Transcript / Consolidated Mark Sheet` |
| PhD | `Bachelor's Transcript`, `Master's Transcript` |

| Study level | Optional |
|---|---|
| UG | IELTS/TOEFL/PTE/Duolingo Score Report, SAT Score Report, Achievement Certificates, Sports Certificates, Olympiad Certificates, Coding/Hackathon Certificates, Passport |
| PG | Degree Certificate, Resume / CV, IELTS/TOEFL/PTE, GRE/GMAT, Certificates, Passport |
| PhD | Degree Certificates, Research Papers, Publications, Resume / CV, IELTS/TOEFL, GRE, Passport |

Onboarding blocks progress until every required document for that level is uploaded.
Uploading the same `documentType` twice **replaces** the existing document.

Since the list is level-dependent, serve it from reference data rather than
hardcoding an enum — otherwise adding a document type means a backend deploy.

---

## Validation summary (for the validators layer)

| Step | Hard rules |
|---|---|
| 1 | email regex; mobile 6–14 digits; country from list; city non-empty |
| 2 | all five arrays ≥ 1; MBBS-only country ⇒ study level MBBS |
| 3 | ≥ 1 level; every field of each selected level required |
| 4/5 | status required; score fields conditional on status |
| 6 | workStatus required; if Yes ⇒ years + per-row fields |
| 7 | 5 required fields; income per earning member; both declarations true |
| 8 | per project: title + role |
| 9 | all required sections complete before SUBMITTED |
