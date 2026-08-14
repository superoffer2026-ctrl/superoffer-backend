# 08 — Reference Data

Eight public, read-only endpoints that serve every dropdown in the student wizard.
**This is where to start building** — no auth, no writes, no schema decisions.

## The governing principle

The frontend's own comment on each call:

> *"Public — no auth required. Single source of truth for ... dropdown data,
> **matching the same lists the backend's own DTO validators check against**."*

So each list must be defined **once** and used **twice** — served by the endpoint
and enforced by the validator. Never copy a list into a validator; import it.

```
src/constants/geo.js                -> exports COUNTRIES, INDIA_CITIES
src/routes/reference.routes.js      -> serves them
src/validators/student.validator.js -> imports the same constants
```

If a list is duplicated, the endpoint and the validator will eventually disagree,
and students will see a dropdown option the server then rejects.

---

## The endpoints

All are `GET`, all public, all under `/reference`.

### /reference/geo
```json
{ "countries": [ { "name": "India", "iso2": "IN", "dial": "+91" } ],
  "indiaCities": [ "..." ] }
```
Used by: personal-information (country combobox, dial-code select, city select).

- `iso2` is what's stored in `mobileCountry` / `altMobileCountry`.
- `dial` builds the derived `phone` string.
- `country` is validated by **exact name match**, so this list is authoritative.
- `indiaCities` — city options currently exist for India only; other countries fall
  back to a free-text input. Consider generalising to `citiesByCountry`.

### /reference/study-preferences
```json
{ "studyCountries": [], "mbbsOnlyCountries": [],
  "fieldsOfStudy": [], "intakeOptions": [], "startYears": [] }
```
- `fieldsOfStudy` backs **two** fields (study level and program).
- `startYears` are strings; the frontend maps them with `Number`.
- `mbbsOnlyCountries` drives a real business rule — see
  [09-Business-Rules.md](09-Business-Rules.md).

### /reference/academic-information
```json
{ "qualificationOptions": [], "curriculumOptions": [],
  "educationGapOptions": [], "educationYears": [], "universityOptions": [] }
```
- `qualificationOptions` — observed: `11th`, `12th`, `Diploma`, `Bachelor's Degree`,
  `Master's Degree`, `PhD`. **Order matters**: the last selected entry is treated as
  the student's highest qualification and drives derived fields.
- `curriculumOptions` — only for 11th/12th.
- `educationYears` — for `startedYear` / `completionYear` selects.
- `universityOptions` — a select that **also allows custom values**, so never
  reject an unlisted institution.

### /reference/english-exam
```json
{ "englishExamOptions": [], "examStatusOptions": [] }
```
Exam names include IELTS, TOEFL, PTE, Duolingo (the search projection regex-matches
these four). `examStatusOptions` must contain exactly:
`I have the score`, `Awaiting Result`, `Yet to be taken`, `Retake` — these strings
are matched literally by the conditional-score logic.

### /reference/competitive-exam
```json
{ "competitiveExamOptions": [], "examStatusOptions": [] }
```
Same status list. Exam names include GRE and GMAT (matched by the projection;
GMAT by prefix, so `GMAT Focus` also works).

### /reference/work-experience
```json
{ "employmentTypes": [] }
```

### /reference/financial-information
```json
{ "fundingSourceOptions": [], "employmentCategoryOptions": [],
  "earningMemberOptions": [], "currencyOptions": [] }
```
- `earningMemberOptions` must include `Father`, `Mother`, `Guardian` — mapped
  literally to `fatherIncome` / `motherIncome` / `guardianIncome`.
- `fundingSourceOptions` must include `Scholarship` and `Combination of the Above`
  — both set `scholarshipSeeking = true` in the search projection.
- `currencyOptions` — the frontend has symbols for
  `INR ₹, USD $, GBP £, EUR €, CAD C$, AUD A$, AED, SGD`.
- `employmentCategoryOptions` — still hardcoded frontend-side in
  `financial-options.ts` as `Salaried, Self-Employed, Business, Agriculture, Other`.
  These values gate which financial documents are requested, so the backend list
  must match exactly.

### /reference/projects-achievements
```json
{ "achievementSuggestions": [] }
```
Autocomplete suggestions only — custom values are allowed.

---

## Failure behaviour

Every consumer wraps these calls in a `try/catch` that swallows errors:

> *"Reference data endpoint unreachable — dropdowns stay empty; existing selections
> still load below."*

So an outage degrades to empty dropdowns rather than a crash. Good news for us, but
it also means **a broken reference endpoint fails silently** — the user just sees an
empty list. Log failures server-side.

---

## Suggested implementation

Static constants in `src/constants/`, served directly. No database, no models.

Add long `Cache-Control` headers — this data changes rarely and is fetched on every
wizard step load.

A later improvement is moving lists into a `referenceData` collection with an admin
UI, but that is premature now.

---

## Financial documents (related, not an endpoint yet)

`financial-options.ts` also defines `FINANCIAL_DOCUMENT_FIELDS`, which the
loan-eligibility page uses. Each is filtered by employment category:

| Key | Label | Categories |
|---|---|---|
| `incomeCertificate` | Income Certificate | all |
| `salarySlips` | Salary Slips (Last 24 Months) | Salaried |
| `payslips` | Payslips (Last 24 Months) | Salaried |
| `form16` | Form 16 (Last 2 FYs) | Salaried |
| `businessIncomeProof` | Business Income Proof | Self-Employed, Business |
| `agriculturalIncomeCertificate` | Agricultural Income Certificate | Agriculture |
| `itr` | Income Tax Return (Last 2 FYs) | Self-Employed, Business, Agriculture, Other |
| `bankStatements` | Bank Statements (Last 6 Months) | all |
| `scholarshipLetter` | Scholarship or Funding Letter | all |

An entry with no categories applies to everyone. This list belongs in reference data
too — it is the same "one list, two uses" pattern.
