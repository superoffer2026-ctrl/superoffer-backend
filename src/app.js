import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';
import { createToken, hashPassword, verifyPassword } from './security.js';
import { studentOffers, studentProfile } from './student-portal-data.js';
import { InMemoryUserStore } from './user-store.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PUBLIC_ROLES = new Set(['STUDENT', 'UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT']);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const normalizeEmail = email => String(email || '').trim().toLowerCase();

export const createApp = ({
  userStore = new InMemoryUserStore(),
  tokenSecret = process.env.AUTH_TOKEN_SECRET || 'development-only-secret-change-before-deploying',
  accessTokenTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 3600,
  refreshTokenTtl = Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 2_592_000,
  logger = console
} = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({
    origin: !process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*'
      ? true
      : process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api-docs.json', (_request, response) => response.json(openApiDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'SuperOffer API Documentation',
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: true
    }
  }));

  app.use((request, response, next) => {
    const requestId = request.get('x-request-id') || crypto.randomUUID();
    response.set('x-request-id', requestId);
    next();
  });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'superoffer-auth', timestamp: new Date().toISOString() });
  });

  app.post('/api/v1/auth/register', async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body.email);
      const password = String(request.body.password || '');
      const role = String(request.body.role || '');

      if (!EMAIL_PATTERN.test(email)) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'A valid email is required' });
      }
      if (!PASSWORD_PATTERN.test(password)) {
        return response.status(400).json({
          code: 'WEAK_PASSWORD',
          message: 'Password must contain at least 8 characters, one letter, and one number'
        });
      }
      if (!PUBLIC_ROLES.has(role)) {
        return response.status(400).json({ code: 'INVALID_ROLE', message: 'The selected role cannot be registered' });
      }
      if (await userStore.findByEmail(email)) {
        return response.status(409).json({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account already exists for this email'
        });
      }

      const user = {
        id: crypto.randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        role,
        emailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const inserted = await userStore.insert(user);
      if (!inserted) {
        return response.status(409).json({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account already exists for this email'
        });
      }

      response.status(201).json({ user_id: user.id, otp_required: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/login', async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body.identifier);
      const password = String(request.body.password || '');
      if (!email || !password) {
        return response.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required'
        });
      }

      const user = await userStore.findByEmail(email);
      if (!user) {
        return response.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
      }

      const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
      if (lockedUntil > Date.now()) {
        return response.status(423).json({
          code: 'ACCOUNT_LOCKED',
          message: 'Account is temporarily locked',
          retry_after_seconds: Math.ceil((lockedUntil - Date.now()) / 1000)
        });
      }

      if (!await verifyPassword(password, user.passwordHash)) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        user.updatedAt = new Date().toISOString();
        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
        }
        await userStore.update(user);
        if (user.lockedUntil) {
          return response.status(423).json({
            code: 'ACCOUNT_LOCKED',
            message: 'Account is temporarily locked',
            retry_after_seconds: Math.ceil(LOCK_DURATION_MS / 1000)
          });
        }
        return response.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
      }

      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.updatedAt = new Date().toISOString();
      await userStore.update(user);

      const claims = { sub: user.id, email: user.email, role: user.role };
      response.json({
        access_token: createToken(claims, { secret: tokenSecret, expiresInSeconds: accessTokenTtl, type: 'access' }),
        refresh_token: createToken(claims, { secret: tokenSecret, expiresInSeconds: refreshTokenTtl, type: 'refresh' }),
        expires_in: accessTokenTtl,
        role: user.role,
        mfa_required: false,
        email_verified: user.emailVerified
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/students/me', (_request, response) => {
    response.json(studentProfile);
  });

  app.get('/api/v1/students/me/offers', (_request, response) => {
    response.json({
      results: studentOffers,
      total_results: studentOffers.length,
      source: 'superoffer-api'
    });
  });

  app.use((request, response) => {
    response.status(404).json({ code: 'ROUTE_NOT_FOUND', message: `${request.method} ${request.path} is not available` });
  });

  app.use((error, _request, response, _next) => {
    logger.error(error);
    response.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
  });

  return { app, userStore };
};
