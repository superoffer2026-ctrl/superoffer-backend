# 01 — System Overview

## What SuperOffer is

A reverse-admissions marketplace. Students build **one** structured profile;
universities and banks search those profiles and send offers. The student never
applies — institutions come to them.

## Portals

Three user-facing portals plus an admin console. Source: `app.routes.ts`.

| Portal | Routes | Users |
|---|---|---|
| Student | `/student/*`, `/student/onboarding` | Students |
| Organization | `/organization/*` | Universities **and** banks, one shared workspace |
| Admin | `/admin` | Super Admin |

A consultancy portal existed and was **deliberately deleted**. Do not build
consultancy features. One leftover artifact is tracked in Open Decision 4.

## Roles

From `core/organization.models.ts`:

```
STUDENT             -> student portal
UNIVERSITY_OFFICER  -> organization portal, organizationType = UNIVERSITY
LOAN_OFFICER        -> organization portal, organizationType = BANK
```

```js
organizationRole(orgType)      // BANK -> 'LOAN_OFFICER', else 'UNIVERSITY_OFFICER'
organizationTypeFromRole(role) // 'LOAN_OFFICER' -> 'BANK', else 'UNIVERSITY'
```

**Universities and banks share one workspace component** (2,432 lines) that switches
behaviour on `organizationType`. Mirror that in the backend: one `organizations`
collection with a `type` discriminator, one set of endpoints, not two of everything.

There is no `SUPER_ADMIN` role. Admin authenticates with a shared secret header
instead — see [07-Admin-Module.md](07-Admin-Module.md) and Open Decision 3.

---

## End-to-end flows

### Student

```
register (email + password)
   -> NOT auto-logged in; frontend shows "Account created. Please log in."
login
   -> /student/dashboard
9-step profile wizard (each step saves independently)
   -> /student/review
submit
   -> status becomes SUBMITTED; profile becomes discoverable
receive offers -> view / compare / shortlist -> accept or reject
```

Two important properties:

1. **Each wizard step saves to its own endpoint** and can be revisited in any order
   via `?from=review`. Steps are not a transaction — partial profiles are normal and
   must persist.
2. **Only `SUBMITTED` students are discoverable.** Drafts are invisible to
   organizations.

### Organization

```
register (org details) -> approvalStatus = PENDING
   -> CANNOT log in yet
Super Admin approves -> APPROVED
login -> /organization/dashboard
create products (programs or loan products) + criteria
discover students (21 filters)
shortlist -> send offer/invitation
   -> student responds -> negotiate -> accepted / rejected
   -> or auto-expires after 14 days
```

### Admin

```
enter admin key -> queue of PENDING registrations
   (auto-refreshes every 15s)
approve (optional note) or reject (reason REQUIRED)
   -> approval unlocks the organization's login
audit log records every decision
```

---

## Module map

| Frontend area | Files | Backend doc |
|---|---|---|
| Auth | `pages/auth/auth-page.component.ts` | 02 |
| Student wizard | `pages/student-portal/*.component.ts` (9 steps) | 04 |
| Student onboarding + documents | `pages/student-onboarding/*` | 04 |
| Student dashboard / offers wallet | `pages/student-portal/offer-wallet.models.ts` | 06 |
| Organization workspace | `pages/organization-portal/organization-workspace.component.ts` | 05 |
| Admin | `pages/admin/admin-page.component.ts` | 07 |
| Reference data | `core/auth-api.service.ts` | 08 |
| Search projection | `core/submitted-students.store.ts` | 05 |

---

## Client-side state you must eventually own

The frontend currently keeps several things in `localStorage` because no backend
exists. Each is really server state:

| Key | Holds | Belongs in |
|---|---|---|
| `superoffer_access_token` | JWT | stays client-side (correct) |
| `superoffer_student_profile_values` | the whole in-progress profile | `studentProfiles` |
| `superoffer_submitted_students` | submitted students for org discovery | `studentProfiles` |
| `superoffer_offer_favourites` / `_saved` / `_compare_selection` | student's offer flags | `offers` |
| `superoffer_bank_evaluation_mode` | which students a bank may see | `organizations` — **access control, must be server-side** |
| `superoffer_org_directory` | email → organizationType | delete once login returns `organizationType` |
| `superoffer_admin_key` | admin secret | stays client-side |

The last one in bold matters: `bankEvaluationMode` governs data visibility. Leaving
it client-side means any bank can see any student by editing localStorage.
