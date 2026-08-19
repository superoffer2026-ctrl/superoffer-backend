# SuperOffer — User Flows (as actually implemented)

These are the flows that exist end-to-end today, verified against the live backend and a real Postgres database — not the aspirational full-platform spec. Anything not listed here (search, invitations, offers, notifications, billing) isn't built yet.

---

## 1. Student — sign-up, login, and profile onboarding

```
Visit /auth/login/student
        │
        ▼
Enter mobile number (+ full name, if new)
        │
        ▼
POST /auth/otp/request  ──► WhatsApp OTP sent (mock in dev — code logged server-side)
        │                    Account auto-created on first request if the phone is new
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
Access + refresh token issued, phone marked verified
        │
        ▼
Redirect to /student/onboarding (first time) or /student/dashboard (returning)
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

**Key business rule enforced:** a student can never register or log in with a password — attempting either returns `STUDENT_USES_OTP_LOGIN` pointing back to the OTP flow.

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
| Duplicate phone on register/OTP request | `409 PHONE_ALREADY_REGISTERED` |
| Registering as `STUDENT` via the password endpoint | `400 STUDENT_USES_OTP_LOGIN`, points to the OTP endpoint |
| Requesting a second OTP inside 30s | `429 OTP_ALREADY_SENT`, with seconds remaining |
| Re-using an already-verified OTP code | `400 OTP_INVALID` |
| 5 wrong OTP attempts in a row | Code invalidated entirely, must request a new one |
| Student tries password login (even with correct-looking identifier) | `400 STUDENT_USES_OTP_LOGIN`, whether identified by email or phone |
| Uploading the wrong document types | Profile completion correctly stays incomplete until the *actually required* types (per study level) are present |

---

## Not yet implemented (no user flow exists)

Search & shortlisting, Invitations/Offers, Notifications, Subscriptions/Billing, Reports & Analytics, AI Matching, Settings. The Angular frontend's organization/consultancy portal pages beyond login are currently static mock UI with no backend calls.
