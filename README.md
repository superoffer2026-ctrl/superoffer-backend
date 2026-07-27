# SuperOffer Authentication Backend

This first backend slice implements university registration and login.

## Endpoints

- `GET /health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api-docs` (Swagger UI)
- `GET /api-docs.json` (OpenAPI document)

## Run locally

```bash
npm install
npm start
```

Copy `.env.example` to `.env` and replace `AUTH_TOKEN_SECRET` before deployment.
When `MONGODB_URI` is set, users persist in MongoDB. Without it, the server uses
an in-memory store intended only for local development.
