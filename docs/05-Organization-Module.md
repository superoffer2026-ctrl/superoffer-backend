# 05 — Organization Module (Universities & Banks)

Source: `pages/organization-portal/organization-workspace.component.ts` (2,432 lines)
and `core/submitted-students.store.ts`.

**One workspace serves both organization types**, switching on `role: 'UNIVERSITY' | 'BANK'`
via a `ROLE_CONFIG` lookup that swaps labels, terminology and available fields.
Build one set of endpoints with a type discriminator — not two parallel modules.

⚠️ This module currently runs on **hardcoded demo data and makes no API calls**.
So unlike the student module, there is no fixed contract to match — the shapes below
are what the UI needs, and you have freedom in the endpoint design.

## Views (each a route under `/organization/`)

```
dashboard, students, shortlists, invitations, catalog, templates,
criteria, reports, notifications, subscription, profile, settings
```

Settings tabs: `org`, `subscription`, `accreditation`, `team`, `notifications`, `security`.

---

## Products

### University program
```ts
{ id, name, category?, degreeLevel: 'Undergraduate'|'Postgraduate', course, country,
  intakes: string[], tuitionFee: string, scholarshipRange: string,
  durationYears: number, seats: number | 'Rolling',
  minCgpa?, englishTest?, minEnglishScore?, preferredCurricula?, targetCountries?,
  templates?, url?, createdAt?, lastModifiedAt?, inviteNote?, templateName? }
```

### Bank loan product
```ts
{ id, name, category?, interestRateMin: number, interestRateMax: number,
  currency: string, maxAmount: string, tenureOptions: number[],
  collateralRequired: boolean, eligibleCountries: string[],
  guarantorRequired?, maxFamilyIncome?,
  templates?, url?, createdAt?, lastModifiedAt?, inviteNote?, templateName? }
```

Note `seats: number | 'Rolling'` — a union of number and literal. In Mongoose use
`Mixed`, or store `seats: Number` plus `rollingAdmission: Boolean`. Money values
(`tuitionFee`, `maxAmount`) are **display strings** with currency baked in
(`"CAD 42,000 / year"`), not numbers.

---

## Criteria

```ts
UniversityCriteria { minCgpa, minEnglishScore, englishTest, preferredCurricula, targetCountries }
BankCriteria       { guarantorRequired, maxFamilyIncome, eligibleCountries }
```

Org-level defaults, overridable per product. Used to compute match scores.

---

## Student discovery — 21 filters

This dictates your query API and your indexes.

```
course, degree, country, intake,
cgpaMin, budgetMin, scholarship,
englishTest, englishScoreMin, greMin, gmatMin,
backlogsMax, workExperienceMin, noVisaRefusals,
familyIncomeMax, requiredLoanMax,
universityName, universityCourse, universityScholarship, offerStatus,
visibility: '' | 'academicOnly' | 'offerAvailable'
```

Semantics from the filter predicate:

| Filter | Operator |
|---|---|
| course, degree, country, intake, englishTest | exact equality |
| cgpaMin, budgetMin, englishScoreMin, greMin, gmatMin, workExperienceMin | `>=` |
| backlogsMax, familyIncomeMax, requiredLoanMax | `<=` |
| scholarship | `'yes'` ⇒ `scholarshipSeeking` true, `'no'` ⇒ false |
| noVisaRefusals | when true, exclude `visaRefused` |
| universityName / universityCourse / offerStatus | **`some()` over the `universityInterests[]` array** |
| universityScholarship | any interest with a scholarship that isn't `'—'` |

The last group means a **bank filters students by the state of their university
offers** — cross-referencing between organization types. Model `universityInterests`
as an indexed array of subdocuments.

### The searchable student document

From `SubmittedStudent`:
```ts
{ id, name, initials, photo, course, country, degree,
  cgpa: string, cgpaValue: number,
  ielts, englishTest: 'IELTS'|'TOEFL'|'PTE'|'Duolingo', englishScore, toefl?,
  backlogs, workExperienceYears, visaRefused, documentsVerified,
  examScore: string, budget: string, budgetValue: number, financialSummary,
  skills: string[], score, factor, intake, scholarshipSeeking, bio, color,
  eligible, eligibilityNote, live, submittedAt,
  gre?, gmat?, familyIncome?, requiredLoanAmount?,
  universityInterests?: [ { university, country, course, status,
                            scholarship?, tuitionFee?, remainingTuition?,
                            livingCost?, logo? } ],
  needsLoan?, employmentCategory?, financialDocuments?: [ {key,label,uploaded} ] }
```

**Display/filter pairs.** Every filterable number exists twice — a display string
and a numeric value:

| Display | Numeric |
|---|---|
| `cgpa` `"8.9 / 10"` | `cgpaValue` `8.9` |
| `budget` `"₹38,00,000"` | `budgetValue` `3800000` |
| `examScore` `"IELTS 7.5 · GRE 323"` | `englishScore`, `gre`, `gmat` |

Store both. Never parse display strings at query time.

### The projection is already written

`mapProfileToOrgStudent(values, photo)` in `core/submitted-students.store.ts`
converts a profile into this document. **Port it to the backend** — it encodes real
decisions:

- `degree`: `'Undergraduate'` if study level matches `/bachelor|undergrad/i`, else `'Postgraduate'`
- `cgpaValue`: first number matched by `/[\d.]+/` in the cgpa string
- `englishTest`: regex on the exam name — `/toefl/i`, `/det/i`→Duolingo, `/pte/i`, else IELTS
- `gre` / `gmat`: from `entranceExam` uppercased, `GMAT` matched by prefix
- `workExperienceYears`: `relevantYears + nonRelevantYears`, but **0 unless `workStatus === 'Yes'`**
- `scholarshipSeeking`: `fundingSource` is `'Scholarship'` or `'Combination of the Above'`
- `score` (completion %): fraction of **14 specific required fields** present —
  fullName, email, mobileNumber, country, city, countries, fieldOfInterest,
  studyLevel, startYear, intake, qualificationLevel, institution, score, graduationYear
- `financialDocuments`: `FINANCIAL_DOCUMENT_FIELDS` filtered by `employmentCategory`,
  included **only when `needsLoan === 'yes'`**

Rebuild this projection on every profile save, or on submit — not at query time.

### Suggested indexes
```js
{ status: 1, country: 1, course: 1, intake: 1 }
{ status: 1, cgpaValue: -1 }
{ status: 1, englishTest: 1, englishScore: -1 }
{ status: 1, budgetValue: -1 }
{ status: 1, 'universityInterests.status': 1 }
```
All compound on `status` — only `SUBMITTED` students are ever discoverable.

---

## Subscription and quota

```
Basic        50 profiles / cycle
Professional 200
Enterprise   Unlimited (Infinity)
```

Tracked against `profilesViewed` per cycle, displayed as a percentage with
"N profile views available" remaining.

Plan unlocks:
| Plan | Unlocks |
|---|---|
| Basic | — |
| Professional | Advanced Filters, Priority Discovery |
| Enterprise | + AI Recommendations |

**This is a paid-quota rule and must be enforced server-side.** Viewing a profile
should increment a counter and be rejected past the cap. Advanced filters must be
rejected for organizations whose plan doesn't unlock them — a client-side check is
trivially bypassed.

---

## Bank evaluation mode

```
ACADEMIC_ONLY | UNIVERSITY_OFFER_ONLY | ACADEMIC_AND_OFFER
```

Feeds `passesVisibility(student)` — it decides **which students a bank may see**.
Currently in `localStorage`. It is an access-control rule; move it to the
organization document and enforce it in the query.

---

## Team

```ts
TeamMember { initials, name, email, role, status: 'Active'|'Invited', isSelf? }
```

`'Invited'` implies an invite-by-email flow with later acceptance. No UI exists
yet — model the field, defer the flow.

---

## Reports

Computed live from offers, never stored:
```
acceptanceRate = accepted / total
viewedRate     = (total - still 'Sent') / total
activeOffersCount, avgResponseTime  (from responseHours)
```
Compute in an aggregation pipeline rather than storing derived counters.
