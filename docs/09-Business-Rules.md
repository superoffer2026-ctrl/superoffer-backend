# 09 — Business Rules

Logic found in the frontend that is **not** obvious from the data model. Each of
these must exist server-side; several are currently only client-side, which means
they are unenforced.

Legend: 🔒 = security/money relevant, currently bypassable.

---

## Access control

### 🔒 Organizations cannot log in until approved
New organization → `approvalStatus = PENDING` → login must be rejected.
Only a Super Admin approval flips it to `APPROVED`.
Students have no approval step.

### 🔒 Only SUBMITTED students are discoverable
Draft profiles must never appear in organization search. Every discovery query
filters on `status = 'SUBMITTED'` — hence `status` leading every compound index.

### 🔒 Bank evaluation mode gates visibility
```
ACADEMIC_ONLY | UNIVERSITY_OFFER_ONLY | ACADEMIC_AND_OFFER
```
Feeds `passesVisibility(student)` and decides which students a bank may see.
**Currently in `localStorage`** — a bank can change it from the browser console.
Move to the organization document and apply it inside the query.

### 🔒 Subscription quota
```
Basic 50 · Professional 200 · Enterprise unlimited   (profiles viewed per cycle)
```
Viewing a profile increments `profilesViewed`; past the cap it must be refused.
Advanced features unlock by plan:

| Plan | Unlocks |
|---|---|
| Basic | — |
| Professional | Advanced Filters, Priority Discovery |
| Enterprise | + AI Recommendations |

This is paid functionality gated only in the UI today. Enforce in the API.

---

## Offer lifecycle

### 14-day auto-expiry
```js
isAutoExpired(offer) =
  !['Accepted','Rejected','Withdrawn'].includes(status) && daysSince(sentAt) >= 14
```
**Derived at read time, not stored.** `displayStatus()` returns `'Expired'` over the
stored status. The UI warns `"Expiring in Nd"` at ≤ 3 days.
Keep it derived — a stored value would need a cron job to stay truthful.

### Terminal states are final
`Accepted`, `Rejected`, `Withdrawn`, or auto-expired ⇒ no withdrawal, no
negotiation, no status change. Enforce server-side.

### Withdrawal is one-way
Confirmed in the UI as *"This can't be undone."*

---

## Student profile

### Sections save independently
Each of the 9 steps writes its own endpoint and can be revisited in any order via
`?from=review`. Partial profiles are the normal state. Treat each section as an
idempotent upsert — never require a complete profile to save one section.

### MBBS-only countries force the study level
If a selected country is in `mbbsOnlyCountries`, the study-level list collapses to
`['MBBS']`, other selections are dropped, and `MBBS` is auto-added.
Reject payloads that combine an MBBS-only country with a non-MBBS study level.

### Exam status determines which scores are required
| status | Required |
|---|---|
| `I have the score` | `score` |
| `Awaiting Result` / `Yet to be taken` | `expectedScore` |
| `Retake` | `currentScore` + `expectedScore` |

### "Attended exams = No" means an empty array
Not a missing value — a deliberate, valid "no exams" state.

### Work experience years only count when employed
`workExperienceYears = relevantYears + nonRelevantYears`, but **0 unless
`workStatus === 'Yes'`**.

### Income fields follow earning members
`Father → fatherIncome`, `Mother → motherIncome`, `Guardian → guardianIncome`.
Only selected members' incomes are required.
`annualHouseholdIncome` is their **sum** — recompute server-side, don't trust the client.

### 🔒 Both declarations must be true
`declarationAccurate` and `declarationConsent` are `requiredTrue`. This is legal
consent — store a timestamp with them.

### Required documents depend on study level
UG / PG / PhD each have a different required list; onboarding blocks until all are
uploaded. Re-uploading the same `documentType` **replaces** the previous file.

### Highest qualification drives the flat fields
The last selected level (in reference-list order) supplies `institution`, `score`,
`graduationYear`, `qualification`, `qualificationLevel`. Those flat fields are what
organization search filters on.

---

## Derived values (compute, never trust the client)

| Value | Rule |
|---|---|
| `phone` | `"<dial> <mobileNumber>"` |
| `location` | `"<city>, <country>"` |
| `annualHouseholdIncome` | sum of provided incomes |
| `cgpaValue` | first `/[\d.]+/` match in the cgpa string |
| `degree` | `/bachelor\|undergrad/i` ⇒ Undergraduate, else Postgraduate |
| `englishTest` | regex on exam name: toefl / det→Duolingo / pte / else IELTS |
| `gre`, `gmat` | from uppercased `entranceExam`; GMAT matched by prefix |
| `scholarshipSeeking` | `fundingSource` ∈ {Scholarship, Combination of the Above} |
| `score` (completion %) | fraction of 14 specific required fields present |
| `financialDocuments` | by `employmentCategory`, **only when `needsLoan === 'yes'`** |
| `JourneyStage` | from status + `compared` + `viewed` |
| `displayStatus` | `Expired` when 14-day rule trips |
| `acceptanceRate`, `viewedRate` | aggregate over offers |

---

## API behaviour contracts

### 401 means "session expired" — and only that
Every wizard step catches 401 by deleting the token and redirecting to
`?sessionExpired=1`. Returning 401 for a validation error logs the user out
mid-form and loses their work. **Use 400 for validation.**

### Always return JSON
The frontend reads `body.message`. A non-JSON error body (like a proxy's plain-text
500) collapses to the generic *"The request could not be completed."*

### 15-second timeout
The client aborts after 15s. Any endpoint that could exceed that — large searches,
file uploads — needs pagination or streaming.

### Reference-data failures are silent
Consumers swallow the error and show empty dropdowns. Log server-side; you will not
get a bug report.
