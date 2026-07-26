# Verified Student and University API responses

Base URL: `/api/v1`

Every endpoint below is called by `test/all-routes.test.js`. All responses include an `x-request-id` header and every request produces a structured `api_request` JSON log.

## System

| Method | Endpoint | Success | Response |
|---|---|---:|---|
| GET | `/health` | 200 | `{ "status": "ok", "service": "superoffer-backend", "database": { "mode": "mongodb" } }` |
| GET | `/api/v1/health` | 200 | Same health contract |

## Student

| Method | Endpoint | Success | Response |
|---|---|---:|---|
| GET | `/students/me` | 200 | Student identity, academics, test scores, preferences, visibility and completion |
| PUT | `/students/me` | 200 | Updated profile plus `{ "matching_recalculation": "QUEUED" }` |
| POST | `/students/me/documents` | 201 | `{ "id", "doc_type", "file_name", "file_url", "verification_status": "PENDING" }` |
| GET | `/students/me/documents` | 200 | `{ "results": [], "total_results": 0 }` |
| DELETE | `/students/me/documents/:documentId` | 204 | Empty response |
| PUT | `/students/me/visibility` | 200 | Updated visibility preferences |
| GET | `/students/me/invitations` | 200 | `{ "results": [], "total_results": 0 }` with optional status/type filtering |
| GET | `/students/me/offers` | 200 | `{ "results": [], "total_results": 0, "source": "superoffer-api" }` |

## University

| Method | Endpoint | Success | Response |
|---|---|---:|---|
| GET | `/university/org` | 200 | Verified university profile and campuses |
| PUT | `/university/org` | 200 | Updated university profile |
| GET | `/university/programs` | 200 | `{ "results": [], "total_results": 0 }` |
| POST | `/university/programs` | 201 | Created program |
| PUT | `/university/programs/:id` | 200 | Updated program |
| GET | `/university/offer-templates` | 200 | Offer-template list |
| POST | `/university/offer-templates` | 201 | Created offer template |
| PUT | `/university/admission-criteria` | 200 | Saved matching criteria and weights |
| POST | `/university/search` | 200 | Ranked students, total results, quota remaining and API source |
| GET | `/university/shortlists` | 200 | Named shortlists and their items |
| POST | `/university/shortlists` | 201 | Created shortlist |
| POST | `/university/shortlists/:id/items` | 201 | Updated shortlist with selected student |
| PATCH | `/university/shortlists/students/:studentId` | 200 | Updated student shortlist flag |
| GET | `/university/offers` | 200 | Sent admission offers |
| POST | `/university/offers` | 201 | Created admission offer with student details |
| GET | `/university/invitations` | 200 | University invitation list with optional status filter |
| POST | `/university/invitations` | 201 | `{ "invitation_id", "status": "SENT", "expires_at" }` |
| GET | `/university/reports/funnel` | 200 | Matched, shortlisted, sent, viewed, negotiating, accepted and rejected totals |

## Shared invitation lifecycle

| Method | Endpoint | Success | Response |
|---|---|---:|---|
| GET | `/invitations/:id` | 200 | Complete invitation, offer, negotiation and history |
| POST | `/invitations/:id/view` | 200 | `{ "status": "VIEWED" }` |
| POST | `/invitations/:id/accept` | 200 | `{ "status": "ACCEPTED" }` |
| POST | `/invitations/:id/reject` | 200 | `{ "status": "REJECTED" }` |
| POST | `/invitations/:id/withdraw` | 200 | `{ "status": "WITHDRAWN" }` |
| POST | `/invitations/:id/negotiate` | 200 | `{ "status": "NEGOTIATING", "negotiation_id" }` |
| POST | `/invitations/:id/negotiate/respond` | 200 | `{ "status": "NEGOTIATING" }` |
| GET | `/invitations/:id/history` | 200 | `{ "history": [{ "from_status", "to_status", "changed_at" }] }` |

## Consistent errors

| Status | Example code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid input |
| 404 | `STUDENT_NOT_FOUND`, `INVITATION_NOT_FOUND` | Requested record does not exist |
| 409 | `INVITATION_ALREADY_RESOLVED`, `NEGOTIATION_ALREADY_USED` | Invalid lifecycle transition |
| 413 | Multer file-size error | Document exceeds 10 MB |
| 415 | `DOCUMENT_TYPE_UNSUPPORTED` | Unsupported document category |
| 503 | `DATABASE_UNAVAILABLE` | MongoDB cannot be reached |
