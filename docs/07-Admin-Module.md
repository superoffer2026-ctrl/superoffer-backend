# 07 — Admin Module

Source: `pages/admin/admin-page.component.ts`.

Purpose: a Super Admin approves or rejects organization registrations. **Approval
is what unlocks an organization's login** — so this module gates the entire
organization side of the product.

## Authentication

Header `x-admin-key: <secret>` — **not** a Bearer token.

The key is typed into a gate screen, verified by attempting
`GET /admin/registrations`, then cached in `sessionStorage`. Any error means "not
authenticated". So: return **401/403 with a JSON body** for a bad key.

The queue **auto-refreshes every 15 seconds** while the admin is on the queue view
and not mid-review. Keep the list endpoint cheap.

---

## Endpoints

### GET /admin/registrations?status=&org_type=

`status`: `PENDING` (default) | `APPROVED` | `REJECTED` | `ALL`
`org_type`: `ALL` | `UNIVERSITY` | `BANK` (a `CONSULTANCY` option is still in the
UI — see Open Decision 4)

```json
{ "registrations": [
    { "user_id": "...", "full_name": "...", "email": "...",
      "role": "UNIVERSITY_OFFICER",
      "organization": { "name": "...", "...": "..." },
      "approval_status": "PENDING",
      "submitted_at": "...", "reviewed_at": "...", "rejection_reason": "..." } ],
  "summary": { } }
```

`summary` drives count badges. After a refresh the UI re-selects the current row by
`user_id`, so that field must be stable.

### PATCH /admin/users/:userId/approval

```json
{ "approval_status": "APPROVED" | "REJECTED",
  "rejection_reason": "...",
  "approval_note": "..." }
```

**Rejection reason is required when rejecting; the approval note is optional.**
The UI enforces this — enforce it server-side too.

Effects:
- `APPROVED` → organization can log in. The UI's own words: *"Organisation approved
  and login unlocked."*
- `REJECTED` → login stays blocked; the reason is shown to the admin, and should
  reach the organization.
- Either → set `reviewed_at` and append an audit entry.

### GET /admin/audit-log?limit=100

```json
{ "entries": [ { "actor": "...", "action": "...", "entity": "...",
                 "organization": "...", "reason": "...", "occurred": "..." } ] }
```

⚠️ `actor` is a problem today: with a single shared key there is no per-admin
identity, so every entry has the same actor. See Open Decision 3.

---

## Naming inconsistency

This module uses `snake_case` (`user_id`, `full_name`, `approval_status`,
`rejection_reason`, `submitted_at`, `reviewed_at`, `org_type`) while every other
endpoint in the system uses `camelCase`.

Only `admin-page.component.ts` consumes these, so it is a one-file frontend change.
**Recommendation: standardise on camelCase now** — mixed conventions cause bugs
indefinitely. Tracked as Open Decision 1.

---

## Not backed by the API

Large parts of the admin console are hardcoded demo data and need no endpoints yet:

- `platformStats` — students, universities, banks, pending verifications, revenue,
  invitation volume, acceptance rate
- `roleBreakdown` — percentage split by role
- Auth-log table (login/logout times, IP, device, browser, failed attempts) with
  search, role/status filters, sorting, pagination and CSV export
- A moderation/disputes list

The auth-log table is a genuine future feature — it implies recording every login
attempt with IP and user agent. Note it; don't build it now.

---

## Approval status model

```
PENDING   default on organization registration; login blocked
APPROVED  login unlocked
REJECTED  login blocked, reason recorded
```

Students have no approval step — they can log in immediately after registering.
So `approvalStatus` applies only to organization accounts, though the admin endpoint
paths (`/admin/users/:userId/approval`) are user-scoped.
