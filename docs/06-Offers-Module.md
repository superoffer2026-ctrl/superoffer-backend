# 06 — Offers & Invitations

One entity, two views. Sources: `student-portal/offer-wallet.models.ts` (student
side) and `organization-portal/organization-workspace.component.ts` (org side).

## The four status vocabularies — keep them separate

```
OfferStatus            (organization's view of its own offer)
  Sent | Viewed | Negotiating | Accepted | Rejected | Withdrawn | Expired

OfferDecisionStatus    (student's decision on a received offer)
  Pending | Shortlisted | Accepted | Rejected

UniversityOfferStatus  (a bank's view of a student's university offers)
  Offer Sent | Shortlisted | Selected | Admitted

JourneyStage           (student's progress tracker — derived, never stored)
  Received | Viewed | Compared | Shortlisted | Accepted | Declined
```

Do not merge these into one enum. They describe different things from different
perspectives, and `UniversityOfferStatus` in particular is what banks filter on.

### JourneyStage is computed, not stored
```js
if (status === 'Accepted')    return 'Accepted';
if (status === 'Rejected')    return 'Declined';
if (status === 'Shortlisted') return 'Shortlisted';
if (offer.compared)           return 'Compared';
if (offer.viewed)             return 'Viewed';
return 'Received';
```
Derive it in the response; never persist it.

---

## Student-side offer

```ts
StudentOffer {
  id, category: 'University'|'Bank'|'Scholarship'|'Consultancy',
  institution, initial, logo?,
  program, headline, received, status: OfferDecisionStatus,
  location, intake, deadline,
  valueLabel, value,            // e.g. "Scholarship" / "40% tuition"
  conditions, nextSteps: string[],
  contact, contactRole,
  messages: OfferMessage[],
  recommended?, viewed, compared, saved, favourite,

  // category-specific comparison fields
  University:  tuitionFee, scholarshipPct, durationYears, qsRanking, placementHighlights
  Bank:        loanAmount, interestRate, emi, moratorium, processingFee, tenure
  Scholarship: amount, coverage, eligibility
  Consultancy: visaServices, accommodationSupport, supportServices
}
```

`valueLabel` / `value` are a **generic display pair** so one card renders any
category — `("Scholarship", "40% tuition")` or `("Loan amount", "Up to ₹35 lakh")`.
Populate them whatever the category.

The category-specific fields exist to power the side-by-side compare view. Store
them in a `terms` subdocument keyed by category rather than 20 sparse top-level fields.

### Student flags
`viewed`, `compared`, `saved`, `favourite` are **per-student, per-offer** booleans
(currently three separate localStorage id-lists). Keep them on the offer document —
each offer belongs to exactly one student.

`toggleCompareSelect` also sets `viewed = true` as a side effect.

---

## Organization-side offer

```ts
Offer { student, initials, course, deadline, status: OfferStatus,
        sent, sentAt?, responseHours?, negotiationMessages?, ... }
```

Bank offers additionally carry `offerType` (`'PreApproved'`), `loanAmount`,
`interestRate`, `emi`, `tenure`, `processingFee`; university offers carry
`scholarship`, `tuition`, `accommodation`.

---

## Lifecycle rules — these belong server-side

### 14-day auto-expiry
```js
isAutoExpired(offer) =
  !['Accepted','Rejected','Withdrawn'].includes(offer.status)
  && daysSince(offer.sentAt) >= 14
```
Expiry is **computed at read time from `sentAt`**, not stored — the UI shows
`displayStatus()`, which returns `'Expired'` over the stored status. It also renders
`"Expiring in 3d"` warnings when ≤ 3 days remain.

Recommendation: keep it derived (a stored status would need a cron job to stay
correct), and expose both `status` and `displayStatus` in the API.

### Terminal states
`Accepted`, `Rejected`, `Withdrawn` — plus auto-expired. Once terminal:
no withdrawal, no negotiation, no status change. Enforce server-side.

### Withdrawal
Organization-initiated, confirmed in the UI as *"This can't be undone."*
Sets status to `Withdrawn`. Blocked when already terminal.

### Negotiation
Either side appends to a message thread:
```ts
{ from: 'institution' | 'student', author, body, time }
```
Identical shape on both sides. An offer is therefore also a conversation.
Model as a subdocument array; split into its own collection only if threads grow long.

---

## Counters the student dashboard needs

```
totalCount, newCount (unviewed), savedCount, acceptedCount,
universityCount, bankCount, scholarshipCount, consultancyCount
```
Return these from an aggregation on `GET /students/me/offers` rather than making
the client count.

---

## Who creates what

| Category | Created by | Exists? |
|---|---|---|
| University | University org | ✅ |
| Bank | Bank org | ✅ |
| Scholarship | — | ❌ no portal creates one (Open Decision 5) |
| Consultancy | — | ❌ portal deleted (Open Decision 4) |

Half the offer categories have no creator. Resolve before building the offer
creation endpoint.
