# SuperOffer Backend

The REST API for **SuperOffer** — an international education marketplace where
universities discover suitable students, view their profiles, shortlist them,
and eventually send offers. Students create one structured profile (personal
details, education, academic scores, study preferences, budget, entrance exams)
and receive relevant opportunities.

This backend is built **one step at a time**. This README always describes what
actually exists today — check *Current development phase* at the bottom before
assuming a feature is implemented.

---

## 1. Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (v18+) |
| Web framework | Express.js |
| Database | MongoDB Atlas |
| ODM (talks to MongoDB) | Mongoose |
| API style | REST, versioned under `/api/v1` |

Planned for later steps: OTP-based authentication, JWT, role-based access control.

---

## 2. Project structure

```
superoffer-backend/
├── src/
│   ├── config/
│   │   ├── database.js      # opens/closes the MongoDB connection
│   │   └── env.js           # loads + validates environment variables
│   ├── controllers/         # handle a request, send a response (thin)
│   ├── models/              # Mongoose schemas        (empty — no models yet)
│   ├── routes/              # map URLs to controllers (no logic)
│   ├── services/            # business logic          (empty for now)
│   ├── middleware/
│   │   └── error.middleware.js   # the one place errors become JSON
│   ├── validators/          # request validation      (empty for now)
│   ├── utils/               # small shared helpers
│   ├── app.js               # configures Express (middleware + routes)
│   └── server.js            # starts everything (config -> DB -> listen)
├── tests/
├── .env                     # your real secrets — NEVER committed
├── .env.example             # placeholder template — safe to commit
├── .gitignore
└── package.json
```

Empty folders contain a `.gitkeep` file. That's only because git cannot track an
empty folder — it has no other purpose, and it disappears once real files arrive.

### Why `app.js` and `server.js` are separate

This is the design decision most worth understanding.

- **`app.js`** describes *what the application is*: which middleware runs, which
  routes exist, how errors are formatted. It never connects to a database and
  never calls `listen()`.
- **`server.js`** owns *the startup sequence*: load config → connect to MongoDB →
  start listening.

Two benefits:

1. **Testing.** Automated tests can `require('./app')` and check that
   `GET /api/v1/health` returns 200 — without a live Atlas cluster. If
   `mongoose.connect()` lived inside `app.js`, every test would need a real
   database just to check a URL.
2. **Clear failure order.** The server refuses to accept requests until the
   database is actually connected, so you never get a "working" API whose every
   query fails.

---

## 3. Installation

```bash
npm install
```

---

## 4. Environment variables

Copy the template, then fill in real values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | no (default `5000`) | Port the API listens on |
| `NODE_ENV` | no (default `development`) | `development` or `production` |
| `MONGODB_URI` | **yes** | MongoDB Atlas connection string |

`MONGODB_URI` is the only required variable, so the app fails immediately and
clearly if it's missing, rather than crashing later with a confusing message.

**`.env` is listed in `.gitignore` and must never be committed** — it contains
your database username and password. Only `.env.example` (placeholders) is
tracked in git.

---

## 5. Running locally

```bash
npm run dev     # development: nodemon restarts the server when you edit a file
npm start       # plain start, no auto-restart (used in production)
```

On startup you should see:

```
[database] Connected to MongoDB. Database: "superoffer"
[server] SuperOffer API running in development mode
[server] Health check: http://localhost:5000/api/v1/health
```

---

## 6. Health-check endpoint

```
GET http://localhost:5000/api/v1/health
```

```json
{
  "success": true,
  "message": "SuperOffer API is running"
}
```

Use this to confirm the server is alive before debugging anything else.

---

## 7. How MongoDB Atlas is connected

`src/config/database.js` calls `mongoose.connect(MONGODB_URI)` exactly once, and
`src/server.js` is the only file that calls it — at startup, before the HTTP
server begins listening. If the connection fails, the process logs a clear
reason and exits with code 1 instead of running in a broken state.

No data models exist yet. This step only proves the connection works. Models
(students, universities, offers) arrive in later steps alongside the APIs
that use them.

**If the connection fails, it is almost always one of these two things:**

1. **Wrong password** in `MONGODB_URI`. Special characters (`@ : / ?`) must be
   URL-encoded.
2. **Your IP address isn't allowed.** In Atlas → **Network Access**, add your
   current IP. Atlas blocks everything by default, and the resulting timeout
   error does not say so clearly.

---

## 8. API versioning

Every route is mounted under `/api/v1/…`. When a future change would break
existing clients (like the deployed Angular frontend), we introduce `/api/v2/…`
alongside v1 rather than changing v1 under everyone's feet.

---

## 9. API response format

Every response uses the same shape, so the frontend can rely on it.

Success:

```json
{ "success": true, "message": "...", "data": { } }
```

(`data` is omitted when there's nothing to return.)

Error:

```json
{ "success": false, "message": "..." }
```

Errors are produced in exactly one place — `src/middleware/error.middleware.js`.
Controllers and services never build error responses themselves; they just
`throw new ApiError(404, 'Student not found')` and the middleware handles the
rest. In development the response also includes a `stack` field for debugging;
in production it never does.

---

## 10. Development rules

These keep the codebase consistent as it grows:

1. No business logic in routes — routes only map a URL to a controller.
2. No database queries in routes.
3. Controllers, services and models stay separate.
4. Configuration stays out of application logic.
5. Use `async/await`, not callbacks.
6. Use the shared response helpers — never hand-build a response shape.
7. Don't duplicate code.
8. Don't create files that aren't needed yet.
9. Don't build future features early.
10. Keep the architecture scalable but appropriate for an early-stage startup.

---

## 11. Current development phase

**Step 1 — Backend Foundation.** ✅ Complete:

- Project structure and npm scripts
- Environment configuration with validation
- MongoDB Atlas connection
- Express app: helmet, CORS, JSON/urlencoded parsing, request logging
- Centralized error handling + 404 handling
- `GET /api/v1/health`

**Not built yet** (deliberately): authentication, OTP, JWT, data models,
student APIs, university APIs, offers, matching, admin features, notifications,
payments.
