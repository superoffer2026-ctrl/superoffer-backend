# 03 — Data Models

Proposed MongoDB collections. Shapes are dictated by the frontend
(see [02](02-API-Contract.md), [04](04-Student-Profile-Module.md),
[05](05-Organization-Module.md)); the *structure* is a recommendation.

⚠️ Read [10-Open-Decisions.md](10-Open-Decisions.md) before implementing.
Decisions 6 (one users collection vs several) and 7 (file storage) change these
schemas directly.

---

## Design decisions taken here

**1. One `users` collection for auth; separate collections for profiles.**
Auth logic stays uniform (one email index, one password check, one JWT). Student
and organization profiles are shaped completely differently, so they get their own
collections referencing `users._id`.

**2. Profile sections are subdocuments, not separate collections.**
They are always read together (`GET /students/me` returns all of them) and always
belong to exactly one student. One document, one read.

**3. Search fields are denormalised into `searchFields`.**
Discovery filters on 21 fields, several of them derived. Recomputing at query time
would make search unusably slow and complex. Rebuild this subdocument whenever a
section is saved.

**4. Money is stored as the frontend uses it.**
The UI works in display strings (`"CAD 42,000 / year"`) and paired numeric values
(`budgetValue: 3800000`). Store both — display for rendering, numeric for filtering.

---

## users

```js
{
  _id, 
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:   { type: String, required: true },   // bcrypt; never return this
  role:           { type: String, enum: ['STUDENT','UNIVERSITY_OFFICER','LOAN_OFFICER'], required: true },
  fullName:       String,

  // organization accounts only; students are always implicitly approved
  approvalStatus: { type: String, enum: ['PENDING','APPROVED','REJECTED'], default: 'PENDING' },
  rejectionReason: String,
  approvalNote:    String,
  reviewedAt:      Date,
  reviewedBy:      String,

  lastLoginAt: Date,
  createdAt, updatedAt        // timestamps: true
}
```

Indexes: `{ email: 1 }` unique · `{ approvalStatus: 1, role: 1 }` (admin queue).

Students should be created with `approvalStatus: 'APPROVED'` so one login check
covers every role.

---

## studentProfiles

```js
{
  userId: { type: ObjectId, ref: 'User', required: true, unique: true },

  status:      { type: String, enum: ['DRAFT','SUBMITTED'], default: 'DRAFT' },
  submittedAt: Date,

  // --- the 9 wizard sections; keys match GET /students/me exactly ---
  personal: {
    fullName, email, mobileCountry, mobileNumber,
    altMobileCountry, altMobileNumber,
    country, city,
    phone, location                    // derived
  },

  studyPreferences: {
    countries: [String], studyLevel: [String], fieldOfInterest: [String],
    startYear: [String], intake: [String]
  },

  academic: {
    qualificationLevel, institution, score, graduationYear, qualification,  // derived from highest
    educationGap: String,
    history: [ {
      level, curriculum, degreeName, specialization, institutionName,
      cgpa, backlogs, startedYear, completionYear, yearsOfEducation
    } ]
  },

  entranceExams: {                     // BOTH exam steps write here
    englishExams:     [ { exam, status, score, expectedScore, currentScore } ],
    competitiveExams: [ { exam, status, score, expectedScore, currentScore } ],
    englishExam, englishScore,         // flattened first english entry
    entranceExam, entranceScore        // flattened first competitive entry
  },

  workExperience: {
    workStatus, relevantYears, nonRelevantYears,
    experiences: [ { companyName, role, type, durationMonths, description } ],
    companyName, jobRole               // flattened first experience
  },

  financial: {
    fundingSource, earningMembers: [String],
    fatherIncome, motherIncome, guardianIncome,
    annualHouseholdIncome,             // computed sum
    currency, employmentCategory, needsLoan,
    declarationAccurate: Boolean, declarationConsent: Boolean,
    declaredAt: Date                   // consent timestamp
  },

  projects: {
    projects: [ { title, role, description } ],
    achievements: [String], links: [String],
    githubLink, linkedinLink,
    projectTitle, projectRole          // flattened first project
  },

  // --- denormalised projection for organization discovery ---
  searchFields: {
    name, initials, photo, course, country, degree, intake,
    cgpa, cgpaValue: Number,
    englishTest, englishScore: Number, ielts: Number, toefl: Number,
    gre: Number, gmat: Number,
    backlogs: Number, workExperienceYears: Number,
    visaRefused: Boolean, documentsVerified: Number,
    examScore, budget, budgetValue: Number, financialSummary,
    familyIncome: Number, requiredLoanAmount: Number,
    skills: [String], score: Number, factor, bio,
    scholarshipSeeking: Boolean, needsLoan, employmentCategory,
    eligible: Boolean, eligibilityNote,
    universityInterests: [ { university, country, course, status,
                             scholarship, tuitionFee, remainingTuition,
                             livingCost, logo } ],
    financialDocuments: [ { key, label, uploaded: Boolean } ]
  },

  createdAt, updatedAt
}
```

Indexes (all lead with `status` — only SUBMITTED students are discoverable):
```js
{ userId: 1 }  unique
{ status: 1, 'searchFields.country': 1, 'searchFields.course': 1, 'searchFields.intake': 1 }
{ status: 1, 'searchFields.cgpaValue': -1 }
{ status: 1, 'searchFields.englishTest': 1, 'searchFields.englishScore': -1 }
{ status: 1, 'searchFields.budgetValue': -1 }
{ status: 1, 'searchFields.universityInterests.status': 1 }
```

Storing sections and `searchFields` together keeps every read one document, at the
cost of rebuilding the projection on each save. That trade is right here: profiles
are written a handful of times and read constantly by search.

---

## organizations

```js
{
  userId: { type: ObjectId, ref: 'User', required: true },
  name:   { type: String, required: true },
  type:   { type: String, enum: ['UNIVERSITY','BANK'], required: true },
  country, phone,

  criteria: {                         // shape depends on type
    minCgpa, minEnglishScore, englishTest, preferredCurricula, targetCountries,
    guarantorRequired: Boolean, maxFamilyIncome: Number, eligibleCountries
  },

  bankEvaluationMode: { type: String,
    enum: ['ACADEMIC_ONLY','UNIVERSITY_OFFER_ONLY','ACADEMIC_AND_OFFER'],
    default: 'ACADEMIC_AND_OFFER' },   // access control — see 09

  subscription: {
    plan: { type: String, enum: ['Basic','Professional','Enterprise'], default: 'Basic' },
    profilesViewed: { type: Number, default: 0 },
    cycleStartedAt: Date
  },

  team: [ { name, email, role, status: { enum: ['Active','Invited'] } } ],
  notificationPrefs: [ { key, label, detail, frequency } ],

  createdAt, updatedAt
}
```

---

## products

One collection for both program and loan products, discriminated by `type` —
mirroring the single shared workspace component.

```js
{
  organizationId: { type: ObjectId, ref: 'Organization', required: true },
  type: { type: String, enum: ['PROGRAM','LOAN'], required: true },
  name, category, url, inviteNote, templateName,

  // PROGRAM
  degreeLevel: { enum: ['Undergraduate','Postgraduate'] },
  course, country, intakes: [String],
  tuitionFee: String, scholarshipRange: String,
  durationYears: Number,
  seats: Number, rollingAdmission: Boolean,      // frontend uses number | 'Rolling'
  minCgpa: Number, englishTest: String, minEnglishScore: Number,
  preferredCurricula: String, targetCountries: String,

  // LOAN
  interestRateMin: Number, interestRateMax: Number,
  currency: String, maxAmount: String,
  tenureOptions: [Number], collateralRequired: Boolean,
  eligibleCountries: [String],
  guarantorRequired: Boolean, maxFamilyIncome: Number,

  createdAt, updatedAt   // frontend reads createdAt / lastModifiedAt
}
```

Index: `{ organizationId: 1, type: 1 }`.

---

## offers

```js
{
  organizationId: { type: ObjectId, ref: 'Organization', required: true },
  studentId:      { type: ObjectId, ref: 'StudentProfile', required: true },
  productId:      { type: ObjectId, ref: 'Product' },

  category: { enum: ['University','Bank','Scholarship','Consultancy'] },
  status:   { enum: ['Sent','Viewed','Negotiating','Accepted','Rejected','Withdrawn','Expired'],
              default: 'Sent' },
  studentDecision: { enum: ['Pending','Shortlisted','Accepted','Rejected'], default: 'Pending' },

  headline, program, location, intake,
  valueLabel, value,                  // generic display pair
  conditions, nextSteps: [String],
  contact, contactRole,
  matchScore: Number, matchBadge: String,

  terms: {},                          // category-specific; see 06

  // student flags
  viewed: Boolean, compared: Boolean, saved: Boolean, favourite: Boolean,

  messages: [ { from: { enum: ['institution','student'] }, author, body, time: Date } ],

  sentAt:   { type: Date, required: true },   // 14-day expiry is computed from this
  deadline: Date,
  respondedAt: Date,

  createdAt, updatedAt
}
```

Indexes: `{ studentId: 1, createdAt: -1 }` (wallet) ·
`{ organizationId: 1, status: 1 }` (pipeline) · `{ sentAt: 1 }` (expiry).

`status: 'Expired'` is in the enum for completeness, but expiry should be **derived
at read time** from `sentAt` — see [09](09-Business-Rules.md).

---

## documents

```js
{
  studentId:    { type: ObjectId, ref: 'StudentProfile', required: true },
  documentType: { type: String, required: true },   // display label, NOT an enum
  fileName, mimeType, size: Number,
  storageKey:   String,                             // S3/Cloudinary key, not the file
  verified:     { type: Boolean, default: false },
  uploadedAt:   Date
}
```

Index: `{ studentId: 1, documentType: 1 }` — re-uploading a type replaces it.

`documentType` must **not** be an enum: the list varies by study level and is
human-readable text. Serve it from reference data.

---

## auditLog

```js
{
  actor, action, entity,
  targetUserId: { type: ObjectId, ref: 'User' },
  organization, reason,
  metadata: {},
  occurred: { type: Date, default: Date.now }
}
```

Index: `{ occurred: -1 }`. Field names match what the admin UI renders.

---

## Not modelled yet

Deliberately deferred until there is a UI or a decision:

- Team invitation acceptance (`status: 'Invited'` exists, no flow)
- Auth/login logs (IP, device, browser — admin table is demo data today)
- Document verification workflow (`documentsVerified: 0..5` implies five documents
  and a verifier; neither is specified)
- Notifications, payments, OTP
