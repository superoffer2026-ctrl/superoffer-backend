import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';
import { createToken, hashPassword, verifyPassword, verifyToken } from './security.js';
import { InMemoryUserStore } from './user-store.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PUBLIC_ROLES = new Set(['STUDENT', 'UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT']);
const INSTITUTION_ROLES = new Set(['UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT']);
const APPROVAL_STATUSES = new Set(['APPROVED', 'REJECTED']);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const normalizeEmail = email => String(email || '').trim().toLowerCase();

export const createApp = ({
  userStore = new InMemoryUserStore(),
  tokenSecret = process.env.AUTH_TOKEN_SECRET || 'development-only-secret-change-before-deploying',
  accessTokenTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 3600,
  refreshTokenTtl = Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 2_592_000,
  adminApprovalKey = process.env.ADMIN_APPROVAL_KEY || 'development-admin-key',
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

  app.get('/', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'superoffer-backend',
      message: 'SuperOffer API is running',
      api_base: '/api/v1',
      health: '/health',
      documentation: '/api-docs',
      openapi: '/api-docs.json'
    });
  });

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

  const requireAccessToken = (request, response, next) => {
    const authorization = request.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const claims = verifyToken(token, { secret: tokenSecret });
    if (!claims) {
      return response.status(401).json({ code: 'AUTH_REQUIRED', message: 'A valid access token is required' });
    }
    request.auth = claims;
    next();
  };

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
      const fullName = String(request.body.full_name || '').trim();
      const organizationName = String(request.body.organization?.name || '').trim();
      if (!fullName) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'Full name is required' });
      }
      if (INSTITUTION_ROLES.has(role) && !organizationName) {
        return response.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Organization name is required for institution registration'
        });
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
        fullName,
        phone: String(request.body.phone || '').trim(),
        passwordHash: await hashPassword(password),
        role,
        emailVerified: false,
        approvalStatus: INSTITUTION_ROLES.has(role) ? 'PENDING' : 'APPROVED',
        organization: INSTITUTION_ROLES.has(role) ? {
          name: organizationName,
          registrationNumber: String(request.body.organization?.registration_number || '').trim(),
          website: String(request.body.organization?.website || '').trim(),
          country: String(request.body.organization?.country || '').trim(),
          city: String(request.body.organization?.city || '').trim(),
          licenseReference: String(request.body.organization?.license_reference || '').trim(),
          organizationType: role === 'UNIVERSITY_OFFICER'
            ? 'UNIVERSITY'
            : role === 'LOAN_OFFICER' ? 'BANK' : 'CONSULTANCY'
        } : null,
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

      response.status(201).json({
        user_id: user.id,
        role: user.role,
        approval_status: user.approvalStatus,
        can_login: user.approvalStatus === 'APPROVED',
        otp_required: false
      });
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

      user.approvalStatus = user.approvalStatus
        || (INSTITUTION_ROLES.has(user.role) ? 'PENDING' : 'APPROVED');
      if (user.approvalStatus === 'PENDING') {
        return response.status(403).json({
          code: 'ACCOUNT_PENDING_APPROVAL',
          message: 'Your organization is still being reviewed by the SuperOffer admin team',
          user_id: user.id,
          approval_status: user.approvalStatus
        });
      }
      if (user.approvalStatus === 'REJECTED') {
        return response.status(403).json({
          code: 'ACCOUNT_REJECTED',
          message: user.rejectionReason || 'Your organization registration was not approved',
          user_id: user.id,
          approval_status: user.approvalStatus
        });
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
        approval_status: user.approvalStatus,
        full_name: user.fullName,
        organization: user.organization,
        mfa_required: false,
        email_verified: user.emailVerified
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/status/:userId', async (request, response, next) => {
    try {
      const user = await userStore.findById(request.params.userId);
      if (!user) {
        return response.status(404).json({ code: 'USER_NOT_FOUND', message: 'Registration was not found' });
      }
      const approvalStatus = user.approvalStatus
        || (INSTITUTION_ROLES.has(user.role) ? 'PENDING' : 'APPROVED');
      response.json({
        user_id: user.id,
        role: user.role,
        approval_status: approvalStatus,
        can_login: approvalStatus === 'APPROVED',
        organization_name: user.organization?.name || null,
        rejection_reason: user.rejectionReason || null,
        submitted_at: user.createdAt,
        reviewed_at: user.reviewedAt || null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/me', requireAccessToken, async (request, response, next) => {
    try {
      const user = await userStore.findById(request.auth.sub);
      if (!user) {
        return response.status(404).json({ code: 'USER_NOT_FOUND', message: 'The signed-in account was not found' });
      }
      response.json({
        user_id: user.id,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        role: user.role,
        approval_status: user.approvalStatus || (INSTITUTION_ROLES.has(user.role) ? 'PENDING' : 'APPROVED'),
        organization: user.organization || null
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v1/admin/users/:userId/approval', async (request, response, next) => {
    try {
      if (request.get('x-admin-key') !== adminApprovalKey) {
        return response.status(401).json({ code: 'ADMIN_UNAUTHORIZED', message: 'A valid admin approval key is required' });
      }
      const approvalStatus = String(request.body.approval_status || '');
      if (!APPROVAL_STATUSES.has(approvalStatus)) {
        return response.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'approval_status must be APPROVED or REJECTED'
        });
      }
      const user = await userStore.findById(request.params.userId);
      if (!user) {
        return response.status(404).json({ code: 'USER_NOT_FOUND', message: 'Registration was not found' });
      }
      if (!INSTITUTION_ROLES.has(user.role)) {
        return response.status(409).json({ code: 'APPROVAL_NOT_REQUIRED', message: 'Student accounts do not require admin approval' });
      }
      user.approvalStatus = approvalStatus;
      user.rejectionReason = approvalStatus === 'REJECTED'
        ? String(request.body.rejection_reason || 'The submitted organization details could not be verified')
        : null;
      user.reviewedAt = new Date().toISOString();
      user.updatedAt = user.reviewedAt;
      await userStore.update(user);
      response.json({
        user_id: user.id,
        approval_status: user.approvalStatus,
        can_login: user.approvalStatus === 'APPROVED',
        reviewed_at: user.reviewedAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/students/me', requireAccessToken, async (request, response, next) => {
    try {
      const user = await userStore.findById(request.auth.sub);
      if (!user || user.role !== 'STUDENT') {
        return response.status(403).json({ code: 'STUDENT_ACCESS_REQUIRED', message: 'A student account is required' });
      }
      const profile = await userStore.findStudentProfile?.(user.id);
      const name = user.fullName || profile?.name || '';
      response.json({
        ...(profile || {}),
        id: user.id,
        user_id: user.id,
        name,
        initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join(''),
        email: user.email,
        phone: user.phone || '',
        completion_percent: profile?.completion_percent || 20,
        preferences: profile?.preferences || {
          target_countries: [],
          target_courses: [],
          budget_band: ''
        },
        source: 'mongodb'
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/students/me/offers', requireAccessToken, async (request, response, next) => {
    try {
      const user = await userStore.findById(request.auth.sub);
      if (!user || user.role !== 'STUDENT') {
        return response.status(403).json({ code: 'STUDENT_ACCESS_REQUIRED', message: 'A student account is required' });
      }
      const offers = await userStore.findStudentOffers?.(user.id) || [];
      response.json({ results: offers, total_results: offers.length, source: 'mongodb' });
    } catch (error) {
      next(error);
    }
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
