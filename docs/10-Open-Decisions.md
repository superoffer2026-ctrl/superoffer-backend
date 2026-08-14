# 10 — Open Decisions

Genuine ambiguities in the frontend. **Each one changes the schema or the API**, so
deciding them now avoids migrations later.

Each has a recommendation. If you'd rather not decide, take the recommendations —
they're all defensible.

---

## 1. `snake_case` vs `camelCase` 🔴 decide first

**The conflict.** The admin API uses `user_id`, `full_name`, `approval_status`,
`rejection_reason`, `submitted_at`, `reviewed_at`, `org_type`. Every other endpoint
uses `camelCase` (`fullName`, `accessToken`, `organizationType`, `mobileNumber`).

**Why it matters.** Mixed conventions mean every developer guesses, forever. It also
forces a translation layer between the admin routes and everything else.

**Recommendation: camelCase everywhere.** Only `admin-page.component.ts` consumes
snake_case, so it's a single frontend file to update. Do it before the admin module
is built, not after.

---

## 2. Two paths for the same data 🔴 decide first

**The conflict.** `auth-api.service.ts` declares both:
```
/students/me , /students/me/<section>          (9 section endpoints + submit)
/student/profile , /student/profile/:section , /student/profile/documents
```
The second set appears to be an earlier design. Only `documents` is unique to it.

**Recommendation:** standardise on `/students/me/*` (plural, RESTful, and what the
live wizard uses). Move documents to `/students/me/documents`. Update the two
services; delete `student-profile-api.service.ts`, which is a stub returning
hardcoded promises anyway.

---

## 3. Admin authentication is a shared key 🟡

**Today.** `x-admin-key: <secret>` from env, cached in `sessionStorage`.

**Problems.** No per-admin identity — every audit entry has the same `actor`. No
revocation without rotating for everyone. No expiry.

**Recommendation:** ship the shared key for launch (it's already built into the UI),
but plan a `SUPER_ADMIN` role with JWT immediately after. Approvals unlock paying
organizations, so "who approved this" will matter. Make the key an env var with no
default so it can never accidentally ship blank.

---

## 4. `Consultancy` still exists as an offer category 🟡

**The conflict.** The consultancy portal was deleted, but `OfferCategory` still
includes `'Consultancy'`, `StudentOffer` still has consultancy comparison fields
(`visaServices`, `accommodationSupport`, `supportServices`), the offer wallet
exposes `consultancyCount`, and the admin filter still offers `CONSULTANCY`.
**Nothing can create such an offer.**

**Recommendation:** drop it from the category enum and remove the admin filter
option. It's dead weight that implies a feature you don't have. Keep the wallet's
comparison-field pattern — it'll be reused.

---

## 5. Who creates `Scholarship` offers? 🟡

**The conflict.** `Scholarship` is an offer category with comparison fields
(`amount`, `coverage`, `eligibility`), but no portal creates one — universities
create University offers, banks create Bank offers.

**Recommendation:** treat scholarships as a **university offer variant**, not a
separate category — university products already carry `scholarshipRange` and offers
carry `scholarshipPct`. If it must stay separate, decide who issues it.

---

## 6. One `users` collection or several? 🔴 decide first

**The question.** Students and organizations have completely different profiles but
identical auth needs.

**Recommendation: one `users` collection for auth** (email, passwordHash, role,
approvalStatus) **plus separate `studentProfiles` and `organizations` collections**
referencing it. One email index, one login path, one JWT shape — while the very
different profile shapes stay clean. This is what [03](03-Data-Models.md) assumes.

---

## 7. Where do uploaded documents live? 🔴 decide before Step 6

**The question.** `uploadStudentDocument` posts multipart `FormData`. Files go
where?

**Recommendation:** object storage (S3 or Cloudinary), with only metadata in Mongo
(`documentType`, `fileName`, `mimeType`, `size`, `storageKey`, `uploadedAt`).
Storing files in MongoDB bloats documents and makes backups painful; the 16MB BSON
limit is a real ceiling for transcripts and passports.

Also decide: max file size, allowed MIME types, and whether documents are
virus-scanned. None are specified anywhere in the frontend.

---

## 8. Who computes `matchScore`? 🟡

**The conflict.** The UI shows `94% AI MATCH` and `PRE-APPROVED` badges from
hardcoded demo data. There's a scoring sketch in the workspace
(`academicFit = clamp(50 + (cgpaValue - minCgpa) * 15)`, plus budget/scholarship fit).

**Recommendation:** compute server-side and store on the offer. Banks filter and
sort on it, so it must be consistent and queryable. Start with the frontend's
formula; make it pluggable.

---

## 9. `documentsVerified: 0..5` implies a workflow that doesn't exist 🟢

The org UI shows "N/5 Verified", so exactly five documents are verifiable. But the
required-document list varies by study level (2–3 required, 6–7 optional), and no UI
verifies anything.

**Decide:** which five documents count, who verifies them (admin? university?), and
what verification means. Until then, `documentsVerified` is always 0 — as
`mapProfileToOrgStudent` already hardcodes.

---

## 10. `visaRefused` is filterable but never collected 🟢

Organizations can filter on "no visa refusals", and it's in the search projection —
but **no wizard step asks the student**, and the projection hardcodes `false`.

**Decide:** add a question to the wizard (probably in personal information or study
preferences), or remove the filter. As-is it's a filter that can never exclude anyone.

---

## 11. Reference data: static or database-backed? 🟢

Lists are served by 8 endpoints and must match the validators exactly.

**Recommendation:** static constants in `src/constants/` for now — no admin UI
exists to edit them, and a database round-trip per dropdown is waste. Revisit when
someone non-technical needs to add a country.

---

## 12. Cycle definition for subscription quotas 🟢

Quotas are "per cycle" (`recruitment cycle` / `lending cycle`) but a cycle is never
defined — calendar month? billing anniversary? intake season?

**Recommendation:** billing month from `cycleStartedAt`, resetting `profilesViewed`.
Simple, predictable, matches how the plans are priced.

---

## Suggested resolution order

| Priority | Decisions | Blocks |
|---|---|---|
| 🔴 Before any schema | 1, 2, 6 | everything |
| 🔴 Before documents | 7 | Step 6 |
| 🟡 Before offers | 4, 5, 8 | Step 9 |
| 🟡 Before admin | 3 | Step 4 |
| 🟢 Whenever | 9, 10, 11, 12 | nothing |
