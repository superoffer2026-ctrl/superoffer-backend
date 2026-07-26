# SuperOffer Backend

Deployment-ready API service for the SuperOffer frontend. This first backend slice uses in-memory demo data so the frontend/API integration and Dokploy deployment can be demonstrated before database work begins.

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

## Dokploy settings

- Build type: `Dockerfile`
- Docker context path: `/backend`
- Dockerfile path: `/backend/Dockerfile` when the repository root is the build context, or `Dockerfile` when `/backend` is the build path
- Application port: `3000`
- Health check path: `/health`
- Environment: `CORS_ORIGIN=https://your-frontend-domain`

Use a generated Dokploy domain if a custom API domain is not ready.
