# SuperOffer Backend

Deployment-ready Node.js and Express.js API service for the SuperOffer frontend. It uses MongoDB when `MONGODB_URI` is configured and keeps an in-memory fallback for isolated frontend development and automated API tests.

## Run locally

```bash
cd backend
npm start
```

Health check: `GET http://localhost:3000/health`

## Implemented endpoints

- `GET /api/v1/health`
- `POST /api/v1/university/search`
- `GET /api/v1/university/shortlists`
- `PATCH /api/v1/university/shortlists/students/:studentId`
- `GET /api/v1/university/offers`
- `POST /api/v1/university/offers`

Every request writes a one-line JSON event to stdout. Dokploy displays these events in the application Logs tab.

See `API_RESPONSES.md` for every implemented Student, University, and shared Invitation endpoint and its verified response contract.

## Dokploy settings

- Build type: `Dockerfile`
- Docker context path: `/backend`
- Dockerfile path: `/backend/Dockerfile` when the repository root is the build context, or `Dockerfile` when `/backend` is the build path
- Application port: `3000`
- Health check path: `/health`
- Environment: `CORS_ORIGIN=https://your-frontend-domain`
- Database: `MONGODB_URI=mongodb://superoffer:<password>@<database-host>:27017/superoffer?authSource=admin`

Use a generated Dokploy domain if a custom API domain is not ready.
