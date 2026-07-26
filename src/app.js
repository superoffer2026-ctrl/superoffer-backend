import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { SuperOfferRepository } from './repository.js';

const normalizeStatus = status => status === 'SENT' ? 'Pending' : status[0] + status.slice(1).toLowerCase();

export const createApp = ({ logger = console, repository = new SuperOfferRepository({ logger }) } = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({
    origin: process.env.CORS_ORIGIN === '*' || !process.env.CORS_ORIGIN
      ? true
      : process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  }));
  app.use(express.json({ limit: '1mb' }));

  app.use((request, response, next) => {
    const startedAt = performance.now();
    const requestId = request.get('x-request-id') || crypto.randomUUID();
    response.set('x-request-id', requestId);
    response.on('finish', () => {
      logger.info(JSON.stringify({
        level: 'info',
        event: 'api_request',
        request_id: requestId,
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        duration_ms: Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString()
      }));
    });
    next();
  });

  const health = async (_request, response, next) => {
    try {
      const database = await repository.checkConnection();
      response.json({
        status: database.connected || database.mode === 'mock' ? 'ok' : 'degraded',
        service: 'superoffer-backend',
        version: '1.0.0',
        database,
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      error.status = 503;
      next(error);
    }
  };

  app.get('/health', health);
  app.get('/api/v1/health', health);

  app.post('/api/v1/university/search', async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.body.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(request.body.page_size) || 25));
      const filters = {
        country: request.body.filters?.country || '',
        query: String(request.body.query || ''),
        sort: request.body.sort || 'MATCH_SCORE',
        page,
        pageSize
      };
      const [results, totalResults] = await Promise.all([
        repository.searchStudents(filters),
        repository.countStudents(filters)
      ]);
      response.json({ results, total_results: totalResults, quota_remaining: 812, source: 'superoffer-api' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/university/shortlists', async (_request, response, next) => {
    try {
      const results = await repository.getShortlistedStudents();
      response.json({ results, total_results: results.length });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v1/university/shortlists/students/:studentId', async (request, response, next) => {
    try {
      if (typeof request.body.shortlisted !== 'boolean') {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'shortlisted must be a boolean' });
      }
      const student = await repository.setShortlisted(Number(request.params.studentId), request.body.shortlisted);
      if (!student) return response.status(404).json({ code: 'STUDENT_NOT_FOUND', message: 'Student was not found' });
      response.json(student);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/university/offers', async (_request, response, next) => {
    try {
      const results = (await repository.listOffers()).map(offer => ({ ...offer, status_label: normalizeStatus(offer.status) }));
      response.json({ results, total_results: results.length });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/university/offers', async (request, response, next) => {
    try {
      const { student_id, program, offer_type, response_deadline, award = 'Admission offer' } = request.body;
      if (!student_id || !program || !offer_type || !response_deadline) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'student_id, program, offer_type and response_deadline are required' });
      }
      const offer = await repository.createOffer({
        studentId: Number(student_id),
        program: String(program),
        offerType: String(offer_type),
        award: String(award),
        responseDeadline: response_deadline
      });
      if (!offer) return response.status(404).json({ code: 'STUDENT_NOT_FOUND', message: 'Student was not found' });
      logger.info(JSON.stringify({ level: 'info', event: 'admission_offer_sent', offer_id: offer.id, student_id: offer.student_id, timestamp: offer.sent_at }));
      response.status(201).json({ ...offer, status_label: 'Pending' });
    } catch (error) {
      next(error);
    }
  });

  app.use((request, response) => {
    response.status(404).json({ code: 'ROUTE_NOT_FOUND', message: `${request.method} ${request.path} is not available` });
  });

  app.use((error, request, response, _next) => {
    const status = Number(error.status) || (error.type === 'entity.parse.failed' ? 400 : 500);
    logger.error(JSON.stringify({
      level: 'error',
      event: 'api_error',
      request_id: response.get('x-request-id'),
      message: error.message,
      timestamp: new Date().toISOString()
    }));
    response.status(status).json({
      code: status === 500 ? 'INTERNAL_SERVER_ERROR' : status === 503 ? 'DATABASE_UNAVAILABLE' : 'INVALID_REQUEST',
      message: status === 500 ? 'An unexpected error occurred' : error.message
    });
  });

  return { app, repository };
};
