import { randomUUID } from 'node:crypto';
import { offers, students } from './data.js';

const json = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
};

const readBody = async request => {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Payload too large'), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
};

const normalizeStatus = status => status === 'SENT' ? 'Pending' : status[0] + status.slice(1).toLowerCase();

export const createHandler = ({ logger = console } = {}) => async (request, response) => {
  const startedAt = performance.now();
  const requestId = request.headers['x-request-id'] || randomUUID();
  const origin = process.env.CORS_ORIGIN || '*';
  const corsHeaders = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,x-request-id',
    'x-request-id': requestId
  };
  let statusCode = 200;

  response.on('finish', () => {
    logger.info(JSON.stringify({
      level: 'info',
      event: 'api_request',
      request_id: requestId,
      method: request.method,
      path: request.url,
      status: response.statusCode,
      duration_ms: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString()
    }));
  });

  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      return response.end();
    }

    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/health' || path === '/api/v1/health')) {
      return json(response, 200, {
        status: 'ok',
        service: 'superoffer-backend',
        version: '1.0.0',
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
      }, corsHeaders);
    }

    if (request.method === 'POST' && path === '/api/v1/university/search') {
      const body = await readBody(request);
      const page = Math.max(1, Number(body.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(body.page_size) || 25));
      const country = body.filters?.country;
      const query = String(body.query || '').toLowerCase();
      const filtered = students
        .filter(student => !country || student.location.includes(country))
        .filter(student => !query || `${student.name} ${student.program} ${student.skills.join(' ')}`.toLowerCase().includes(query))
        .sort((a, b) => body.sort === 'NAME' ? a.name.localeCompare(b.name) : b.score - a.score);
      const start = (page - 1) * pageSize;
      return json(response, 200, {
        results: filtered.slice(start, start + pageSize),
        total_results: filtered.length,
        quota_remaining: 812,
        source: 'superoffer-api'
      }, corsHeaders);
    }

    if (request.method === 'GET' && path === '/api/v1/university/shortlists') {
      return json(response, 200, {
        results: students.filter(student => student.shortlisted),
        total_results: students.filter(student => student.shortlisted).length
      }, corsHeaders);
    }

    const shortlistMatch = path.match(/^\/api\/v1\/university\/shortlists\/students\/(\d+)$/);
    if (request.method === 'PATCH' && shortlistMatch) {
      const student = students.find(item => item.id === Number(shortlistMatch[1]));
      if (!student) return json(response, 404, { code: 'STUDENT_NOT_FOUND', message: 'Student was not found' }, corsHeaders);
      const body = await readBody(request);
      if (typeof body.shortlisted !== 'boolean') {
        return json(response, 400, { code: 'VALIDATION_ERROR', message: 'shortlisted must be a boolean' }, corsHeaders);
      }
      student.shortlisted = body.shortlisted;
      return json(response, 200, student, corsHeaders);
    }

    if (request.method === 'GET' && path === '/api/v1/university/offers') {
      const results = offers.map(offer => ({
        ...offer,
        status_label: normalizeStatus(offer.status),
        student: students.find(student => student.id === offer.student_id)
      }));
      return json(response, 200, { results, total_results: results.length }, corsHeaders);
    }

    if (request.method === 'POST' && path === '/api/v1/university/offers') {
      const body = await readBody(request);
      const student = students.find(item => item.id === Number(body.student_id));
      if (!student) return json(response, 404, { code: 'STUDENT_NOT_FOUND', message: 'Student was not found' }, corsHeaders);
      if (!body.program || !body.offer_type || !body.response_deadline) {
        return json(response, 400, { code: 'VALIDATION_ERROR', message: 'program, offer_type and response_deadline are required' }, corsHeaders);
      }
      const offer = {
        id: randomUUID(),
        student_id: student.id,
        program: String(body.program),
        award: String(body.award || 'Admission offer'),
        status: 'SENT',
        sent_at: new Date().toISOString()
      };
      offers.unshift(offer);
      logger.info(JSON.stringify({ level: 'info', event: 'admission_offer_sent', offer_id: offer.id, student_id: student.id, timestamp: offer.sent_at }));
      return json(response, 201, { ...offer, status_label: 'Pending', student }, corsHeaders);
    }

    statusCode = 404;
    return json(response, statusCode, {
      code: 'ROUTE_NOT_FOUND',
      message: `${request.method} ${path} is not available`
    }, corsHeaders);
  } catch (error) {
    statusCode = Number(error.status) || 500;
    logger.error(JSON.stringify({
      level: 'error',
      event: 'api_error',
      request_id: requestId,
      message: error.message,
      timestamp: new Date().toISOString()
    }));
    return json(response, statusCode, {
      code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST',
      message: statusCode === 500 ? 'An unexpected error occurred' : error.message
    }, corsHeaders);
  }
};
