# SuperOffer — User Flows (as actually implemented)

These are the flows that exist end-to-end today, verified against the live backend and a real Postgres database — not the aspirational full-platform spec. Anything not listed here (search, invitations, offers, notifications, billing) isn't built yet.

---

## 1. Student — sign-up, login, and profile onboarding

```
Visit /auth/register/student
        │
        ▼
Enter full name, WhatsApp number (+91 fixed, 10 digits), password
        │
        ▼
POST /auth/register  ──► WhatsApp OTP sent (mock in dev — code logged server-side)
        │                 Row written, but phoneVerifiedAt null: the account cannot be used yet
        ▼
Enter the 6-digit code
        │
        ▼
POST /auth/otp/verify
        │
        ├─ wrong code ──► error shown, same step, up to 5 tries before the code is invalidated
        ├─ expired (5 min) ──► must request a new code
        │
        ▼ correct code
Phone marked verified, access + refresh token issued
        │
        ▼
Redirect to /student/dashboard

Returning:   /auth/login/student — WhatsApp number + password, no OTP
Forgotten:   POST /auth/otp/request {PASSWORD_RESET} → verify → reset_token
             → POST /auth/password/reset → log in normally
        │
        ▼
10-step onboarding wizard, autosaves every step:
  1. Basic info            → PUT /students/me   {basic}
  2. Study level (UG/PG/PhD)
  3. Academic background   → PUT /students/me   {academic}   (fields differ by study level)
  4. Study preferences     → PUT /students/me   {preferences}
  5. Tests completed       → PUT /students/me   {selectedTests, testDetails}
  6. Achievements          → PUT /students/me   {achievements}
  7. Document upload       → POST /students/me/documents  (required docs vary by study level)
  8. Financial preferences → PUT /students/me/financial
  9. Profile links         → PUT /students/me   {links}   (optional)
 10. Review & confirm      → POST /students/me/submit  →  status becomes SUBMITTED
        │
        ▼
Dashboard — profile now discoverable
```

**Key business rule enforced:** a student account has no email address anywhere — the WhatsApp
number is the identity. A code is required once, to prove that number at registration; after that
sign-in is number + password. Logging in before the number is confirmed returns `PHONE_NOT_VERIFIED`
and sends the student back to the code step, so an abandoned signup can be resumed.

---

## 2. Institution (University / Bank) — registration and approval gate

```
Visit /auth/register/organization
        │
        ▼
Fill: organization name, type (University/Bank), country, official email, phone, password
        │
        ▼
POST /auth/register  ──► Organization row created, verificationStatus = PENDING
        │                 User row created, tied to that organization
        ▼
"Registration submitted — await Super Admin review" (no token issued yet)
        │
        ▼
Officer attempts to log in early
        │
        ▼
POST /auth/login  ──► 403 ACCOUNT_PENDING_APPROVAL  (login is blocked, not just feature-limited)
        │
        │        ◄── meanwhile, a Super Admin reviews and approves/rejects (see flow 4)
        ▼
Officer logs in again after approval
        │
        ▼
POST /auth/login  ──► 200, access + refresh tokens, organization details in the response
        │
        ▼
Redirected to /organization/dashboard
```

If rejected instead: `POST /auth/login` returns `403 ACCOUNT_REJECTED` with the Super Admin's stated reason, indefinitely, until someone re-reviews the case manually in the database (no re-submit flow exists yet).

**Security note verified live:** 5 wrong password attempts locks the account for 15 minutes (`423 ACCOUNT_LOCKED`) — independently of approval status, and the lock is stored in Postgres, so it survives a server restart.

---

## 3. Consultancy — registration and approval gate

Same shape as flow 2, with a different registration form (full name, organization legal name, registration number, licence reference — no country/org-type selector, since the role is always `CONSULTANT` → organization type `CONSULTANCY`).

---

## 4. Super Admin — verification queue

```
Visit /admin
        │
        ▼
Enter the shared admin approval key (not a personal login — a header secret)
        │
        ▼
GET /admin/registrations?status=PENDING&org_type=ALL
        │
        ▼
Queue view: filter by status (Pending/Approved/Rejected/All) and org type
(University/Bank/Consultancy/All); metric tiles always show totals across all orgs
        │
        ▼
Select a registration → review organization details (registration number,
licence reference, website, location, submission date)
        │
        ├─ Approve ──► PATCH /admin/users/:id/approval  {approval_status: APPROVED, approval_note}
        │                    └─► officer can now log in; AuditLog entry: ORGANIZATION_APPROVED
        │
        └─ Reject  ──► PATCH /admin/users/:id/approval  {approval_status: REJECTED, rejection_reason}
                             └─► officer sees the reason on every login attempt; AuditLog entry: ORGANIZATION_REJECTED
        │
        ▼
GET /admin/audit-log — full history of every approval/rejection decision
```

---

## Error/edge paths verified live

| Scenario | What happens |
|---|---|
| Duplicate email on register | `409 EMAIL_ALREADY_REGISTERED` |
| Registering a number that already has a confirmed account | `409 PHONE_ALREADY_REGISTERED` |
| Requesting a code for a number with no student account | `404 USER_NOT_FOUND` |
| Requesting a second OTP inside 30s | `429 OTP_ALREADY_SENT`, with seconds remaining |
| Re-using an already-verified OTP code | `400 OTP_INVALID` |
| 5 wrong OTP attempts in a row | Code invalidated entirely, must request a new one |
| Signing in before the registration code is confirmed | `403 PHONE_NOT_VERIFIED`, returns to the code step |
| Using a password-reset token as a session token | `401 SESSION_EXPIRED` — it carries no `sid` |
| Uploading the wrong document types | Profile completion correctly stays incomplete until the *actually required* types (per study level) are present |

---

## Not yet implemented (no user flow exists)

Search & shortlisting, Invitations/Offers, Notifications, Subscriptions/Billing, Reports & Analytics, AI Matching, Settings. The Angular frontend's organization/consultancy portal pages beyond login are currently static mock UI with no backend calls.
