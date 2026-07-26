import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { ModuleStore } from './module-store.js';
import { SuperOfferRepository } from './repository.js';

const normalizeStatus = status => status === 'SENT' ? 'Pending' : status[0] + status.slice(1).toLowerCase();

export const createApp = ({ logger = console, repository = new SuperOfferRepository({ logger }) } = {}) => {
  const app = express();
  const moduleStore = new ModuleStore(repository);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

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

  app.get('/api/v1/university/org', async (_request, response, next) => {
    try {
      response.json(await moduleStore.get('university_org', { id: 'university-northbridge' }));
    } catch (error) { next(error); }
  });

  app.put('/api/v1/university/org', async (request, response, next) => {
    try {
      if (!request.body.name) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });
      const org = await moduleStore.update('university_org', { id: 'university-northbridge' }, request.body);
      response.json(org);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/university/programs', async (_request, response, next) => {
    try {
      const results = await moduleStore.list('university_programs');
      response.json({ results, total_results: results.length });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/university/programs', async (request, response, next) => {
    try {
      if (!request.body.name || !request.body.degree_level) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'name and degree_level are required' });
      }
      response.status(201).json(await moduleStore.insert('university_programs', request.body));
    } catch (error) { next(error); }
  });

  app.put('/api/v1/university/programs/:id', async (request, response, next) => {
    try {
      const program = await moduleStore.update('university_programs', { id: request.params.id }, request.body);
      if (!program) return response.status(404).json({ code: 'PROGRAM_NOT_FOUND', message: 'Program was not found' });
      response.json(program);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/university/offer-templates', async (_request, response, next) => {
    try {
      const results = await moduleStore.list('university_offer_templates');
      response.json({ results, total_results: results.length });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/university/offer-templates', async (request, response, next) => {
    try {
      if (!request.body.name || !request.body.default_terms) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'name and default_terms are required' });
      }
      response.status(201).json(await moduleStore.insert('university_offer_templates', request.body));
    } catch (error) { next(error); }
  });

  app.put('/api/v1/university/admission-criteria', async (request, response, next) => {
    try {
      if (!request.body.criteria_weights) {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'criteria_weights is required' });
      }
      const current = await moduleStore.get('university_admission_criteria', { id: 'criteria-default' });
      const criteria = current
        ? await moduleStore.update('university_admission_criteria', { id: 'criteria-default' }, request.body)
        : await moduleStore.insert('university_admission_criteria', { id: 'criteria-default', ...request.body });
      response.json(criteria);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/students/me', async (_request, response, next) => {
    try {
      const student = await repository.getStudent(1);
      if (!student) return response.status(404).json({ code: 'STUDENT_NOT_FOUND', message: 'Student profile was not found' });
      const stored = await moduleStore.get('student_profiles', { id: 1 });
      response.json({
        ...student,
        ...stored,
        name: student.name,
        initials: student.initials,
        location: student.location,
        program: student.program,
        education: student.education,
        gpa: student.gpa,
        exam: student.exam,
        score: student.score,
        skills: student.skills,
        shortlisted: student.shortlisted,
        color: student.color,
        source: 'superoffer-api'
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/students/me/offers', async (_request, response, next) => {
    try {
      const results = (await repository.getStudentOffers(1)).map(offer => ({
        ...offer,
        status_label: normalizeStatus(offer.status)
      }));
      response.json({ results, total_results: results.length, source: 'superoffer-api' });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/v1/students/me', async (request, response, next) => {
    try {
      const current = await moduleStore.get('student_profiles', { id: 1 });
      const allowed = ['first_name', 'last_name', 'date_of_birth', 'nationality', 'academic_records', 'test_scores', 'preferences'];
      const changes = Object.fromEntries(Object.entries(request.body).filter(([key]) => allowed.includes(key)));
      if (!Object.keys(changes).length) {
        return response.status(400).json({ code: 'PROFILE_INCOMPLETE_FIELD', message: 'No supported profile fields were provided' });
      }
      const completion = Math.min(100, (current?.completion_percent || 80) + 2);
      const profile = await moduleStore.update('student_profiles', { id: 1 }, { ...changes, completion_percent: completion });
      response.json({ ...profile, matching_recalculation: 'QUEUED' });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/students/me/documents', upload.single('file'), async (request, response, next) => {
    try {
      const supported = ['TRANSCRIPT', 'ID', 'TEST_SCORE_REPORT', 'SOP', 'OTHER'];
      if (!supported.includes(request.body.doc_type)) {
        return response.status(415).json({ code: 'DOCUMENT_TYPE_UNSUPPORTED', message: 'Unsupported document type' });
      }
      if (!request.file) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'file is required' });
      const document = await moduleStore.insert('student_documents', {
        student_id: 1,
        doc_type: request.body.doc_type,
        file_name: request.file.originalname,
        file_url: `/uploads/${crypto.randomUUID()}-${request.file.originalname}`,
        size_bytes: request.file.size,
        mime_type: request.file.mimetype,
        verification_status: 'PENDING'
      });
      response.status(201).json(document);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/students/me/documents', async (_request, response, next) => {
    try {
      const results = await moduleStore.list('student_documents', { student_id: 1 });
      response.json({ results, total_results: results.length });
    } catch (error) { next(error); }
  });

  app.delete('/api/v1/students/me/documents/:documentId', async (request, response, next) => {
    try {
      const removed = await moduleStore.remove('student_documents', { id: request.params.documentId });
      if (!removed) return response.status(404).json({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found' });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.put('/api/v1/students/me/visibility', async (request, response, next) => {
    try {
      if (typeof request.body.visible !== 'boolean') {
        return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'visible must be a boolean' });
      }
      const profile = await moduleStore.get('student_profiles', { id: 1 });
      const visibility = { ...profile.visibility, ...request.body };
      await moduleStore.update('student_profiles', { id: 1 }, { visibility });
      response.json(visibility);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/students/me/invitations', async (request, response, next) => {
    try {
      let results = await moduleStore.list('invitations', { student_id: 1 });
      if (request.query.status) results = results.filter(item => item.status === request.query.status);
      if (request.query.type) results = results.filter(item => item.sender_org_type === request.query.type);
      response.json({ results, total_results: results.length });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/university/search', async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.body.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(request.body.page_size) || 25));
      const filters = {
        country: request.body.filters?.country || '',
        query: String(request.body.natural_language_query || request.body.query || ''),
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
      const results = await moduleStore.list('shortlists');
      response.json({ results, total_results: results.length });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/university/shortlists', async (request, response, next) => {
    try {
      if (!request.body.name) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });
      response.status(201).json(await moduleStore.insert('shortlists', { name: request.body.name, items: [] }));
    } catch (error) { next(error); }
  });

  app.post('/api/v1/university/shortlists/:id/items', async (request, response, next) => {
    try {
      const shortlist = await moduleStore.get('shortlists', { id: request.params.id });
      if (!shortlist) return response.status(404).json({ code: 'SHORTLIST_NOT_FOUND', message: 'Shortlist was not found' });
      const student = await repository.getStudent(Number(request.body.student_id));
      if (!student) return response.status(404).json({ code: 'STUDENT_NOT_FOUND', message: 'Student was not found' });
      if (!shortlist.items.some(item => item.student_id === student.id)) {
        shortlist.items.push({ student_id: student.id, added_at: new Date().toISOString() });
      }
      response.status(201).json(await moduleStore.update('shortlists', { id: shortlist.id }, { items: shortlist.items }));
    } catch (error) { next(error); }
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

  app.post('/api/v1/university/invitations', async (request, response, next) => {
    try {
      if (!request.body.student_id || !request.body.offer?.offer_type || !request.body.offer?.value_summary) {
        return response.status(400).json({ code: 'OFFER_TERMS_INVALID', message: 'student_id and complete offer details are required' });
      }
      const invitation = await moduleStore.insert('invitations', {
        student_id: Number(request.body.student_id),
        sender_org_type: 'UNIVERSITY',
        sender_org_id: 'university-northbridge',
        status: 'SENT',
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        offer: request.body.offer,
        history: []
      });
      response.status(201).json({ invitation_id: invitation.id, status: invitation.status, expires_at: invitation.expires_at });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/university/invitations', async (request, response, next) => {
    try {
      let results = await moduleStore.list('invitations', { sender_org_type: 'UNIVERSITY' });
      if (request.query.status) results = results.filter(item => item.status === request.query.status);
      response.json({ results, total_results: results.length });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/university/reports/funnel', async (request, response, next) => {
    try {
      const invitations = await moduleStore.list('invitations', { sender_org_type: 'UNIVERSITY' });
      const count = status => invitations.filter(item => item.status === status).length;
      response.json({
        period: request.query.period || '30d',
        matched: await repository.countStudents({ country: '', query: '' }),
        shortlisted: (await repository.getShortlistedStudents()).length,
        offers_sent: invitations.length,
        viewed: count('VIEWED'),
        negotiating: count('NEGOTIATING'),
        accepted: count('ACCEPTED'),
        rejected: count('REJECTED')
      });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/invitations/:id', async (request, response, next) => {
    try {
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      response.json(invitation);
    } catch (error) { next(error); }
  });

  const transitionInvitation = targetStatus => async (request, response, next) => {
    try {
      const result = await moduleStore.updateInvitation(request.params.id, targetStatus, targetStatus === 'VIEWED' ? { viewed_at: new Date().toISOString() } : { resolved_at: new Date().toISOString() });
      if (!result) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      if (result.terminal) return response.status(409).json({ code: 'INVITATION_ALREADY_RESOLVED', message: 'Invitation is already resolved' });
      response.json({ status: result.invitation.status });
    } catch (error) { next(error); }
  };

  app.post('/api/v1/invitations/:id/view', async (request, response, next) => {
    try {
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      if (invitation.status !== 'SENT') return response.json({ status: invitation.status });
      const result = await moduleStore.updateInvitation(request.params.id, 'VIEWED', { viewed_at: new Date().toISOString() });
      response.json({ status: result.invitation.status });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/invitations/:id/accept', async (request, response, next) => {
    try {
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      const invitations = await moduleStore.list('invitations', { student_id: invitation.student_id });
      const existing = invitations.find(item =>
        item.id !== invitation.id &&
        item.sender_org_type === invitation.sender_org_type &&
        item.status === 'ACCEPTED'
      );
      if (existing) {
        return response.status(409).json({ code: 'CATEGORY_ALREADY_ACCEPTED', existing_invitation_id: existing.id });
      }
      const result = await moduleStore.updateInvitation(invitation.id, 'ACCEPTED', { resolved_at: new Date().toISOString() });
      if (result.terminal) return response.status(409).json({ code: 'INVITATION_ALREADY_RESOLVED', message: 'Invitation is already resolved' });
      response.json({ status: result.invitation.status });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/invitations/:id/reject', transitionInvitation('REJECTED'));
  app.post('/api/v1/invitations/:id/withdraw', transitionInvitation('WITHDRAWN'));

  app.post('/api/v1/invitations/:id/negotiate', async (request, response, next) => {
    try {
      if (!request.body.message) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      if (invitation.negotiation?.student_used) return response.status(409).json({ code: 'NEGOTIATION_ALREADY_USED', message: 'Student negotiation has already been used' });
      const negotiation = {
        id: invitation.negotiation?.id || crypto.randomUUID(),
        status: 'OPEN',
        student_used: true,
        messages: [...(invitation.negotiation?.messages || []), { sender: 'STUDENT', message: request.body.message, proposed_terms: request.body.proposed_terms || {}, sent_at: new Date().toISOString() }]
      };
      const result = await moduleStore.updateInvitation(invitation.id, 'NEGOTIATING', { negotiation });
      response.json({ status: result.invitation.status, negotiation_id: negotiation.id });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/invitations/:id/negotiate/respond', async (request, response, next) => {
    try {
      if (!request.body.message) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      if (!invitation.negotiation) return response.status(409).json({ code: 'NEGOTIATION_NOT_OPEN', message: 'Negotiation has not started' });
      invitation.negotiation.messages.push({ sender: 'UNIVERSITY', message: request.body.message, revised_terms: request.body.revised_terms || {}, hold_firm: Boolean(request.body.hold_firm), sent_at: new Date().toISOString() });
      await moduleStore.update('invitations', { id: invitation.id }, { negotiation: invitation.negotiation });
      response.json({ status: 'NEGOTIATING' });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/invitations/:id/history', async (request, response, next) => {
    try {
      const invitation = await moduleStore.get('invitations', { id: request.params.id });
      if (!invitation) return response.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'Invitation was not found' });
      response.json({ history: invitation.history || [] });
    } catch (error) { next(error); }
  });

  app.use((request, response) => {
    response.status(404).json({ code: 'ROUTE_NOT_FOUND', message: `${request.method} ${request.path} is not available` });
  });

  app.use((error, request, response, _next) => {
    const status = error.code === 'LIMIT_FILE_SIZE'
      ? 413
      : Number(error.status) || (error.type === 'entity.parse.failed' ? 400 : 500);
    logger.error(JSON.stringify({
      level: 'error',
      event: 'api_error',
      request_id: response.get('x-request-id'),
      message: error.message,
      timestamp: new Date().toISOString()
    }));
    response.status(status).json({
      code: error.code === 'LIMIT_FILE_SIZE'
        ? 'DOCUMENT_TOO_LARGE'
        : status === 500 ? 'INTERNAL_SERVER_ERROR' : status === 503 ? 'DATABASE_UNAVAILABLE' : 'INVALID_REQUEST',
      message: status === 500 ? 'An unexpected error occurred' : error.message
    });
  });

  return { app, repository, moduleStore };
};
