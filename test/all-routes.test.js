import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let repository;

const call = async (path, { method = 'GET', body, form } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: form ? undefined : body === undefined ? undefined : { 'content-type': 'application/json' },
    body: form || (body === undefined ? undefined : JSON.stringify(body))
  });
  const payload = response.status === 204 ? null : await response.json();
  assert.ok(response.headers.get('x-request-id'), `${method} ${path} must return x-request-id`);
  return { response, payload };
};

before(async () => {
  const created = createApp({ logger: { info() {}, error() {} } });
  repository = created.repository;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await repository.close();
});

test('every documented University, Student, and Invitation API returns a valid response', async () => {
  let result = await call('/health');
  assert.equal(result.response.status, 200);
  result = await call('/api/v1/health');
  assert.equal(result.payload.status, 'ok');

  result = await call('/api/v1/university/org');
  assert.equal(result.payload.verification_status, 'VERIFIED');
  result = await call('/api/v1/university/org', { method: 'PUT', body: { name: 'Northbridge University', official_domain: 'northbridge.edu' } });
  assert.equal(result.payload.name, 'Northbridge University');

  result = await call('/api/v1/university/programs');
  assert.ok(result.payload.total_results >= 2);
  result = await call('/api/v1/university/programs', { method: 'POST', body: { name: 'MBA Analytics', degree_level: 'Masters', intake_terms: ['Spring 2028'], seats_available: 35 } });
  assert.equal(result.response.status, 201);
  const programId = result.payload.id;
  result = await call(`/api/v1/university/programs/${programId}`, { method: 'PUT', body: { seats_available: 40 } });
  assert.equal(result.payload.seats_available, 40);

  result = await call('/api/v1/university/offer-templates');
  assert.ok(Array.isArray(result.payload.results));
  result = await call('/api/v1/university/offer-templates', { method: 'POST', body: { name: 'Merit Award', default_terms: { scholarship_percent: 20 } } });
  assert.equal(result.response.status, 201);
  result = await call('/api/v1/university/admission-criteria', { method: 'PUT', body: { program_id: programId, min_score: 72, criteria_weights: { academics: 40, exams: 25, skills: 20, financial_fit: 15 } } });
  assert.equal(result.payload.min_score, 72);

  result = await call('/api/v1/university/search', { method: 'POST', body: { filters: { target_countries: ['CA'] }, natural_language_query: 'data', sort: 'MATCH_SCORE', page: 1, page_size: 5 } });
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.payload.results));

  result = await call('/api/v1/university/shortlists');
  assert.ok(Array.isArray(result.payload.results));
  result = await call('/api/v1/university/shortlists', { method: 'POST', body: { name: 'Test shortlist' } });
  assert.equal(result.response.status, 201);
  const shortlistId = result.payload.id;
  result = await call(`/api/v1/university/shortlists/${shortlistId}/items`, { method: 'POST', body: { student_id: 1 } });
  assert.equal(result.payload.items[0].student_id, 1);
  result = await call('/api/v1/university/shortlists/students/1', { method: 'PATCH', body: { shortlisted: true } });
  assert.equal(result.payload.shortlisted, true);

  result = await call('/api/v1/university/offers');
  assert.ok(Array.isArray(result.payload.results));
  result = await call('/api/v1/university/offers', { method: 'POST', body: { student_id: 1, program: 'MSc Data Science', offer_type: 'CONDITIONAL_ADMISSION', response_deadline: '2026-08-15', award: '40% scholarship' } });
  assert.equal(result.response.status, 201);

  result = await call('/api/v1/students/me');
  assert.equal(result.payload.first_name, 'Aarav');
  result = await call('/api/v1/students/me', { method: 'PUT', body: { nationality: 'Indian', preferences: { target_countries: ['CA'], target_courses: ['Data Science'], degree_level: 'Masters', intake_term: 'Fall 2027', budget_band: '25000-35000 USD', scholarship_need: true } } });
  assert.equal(result.payload.matching_recalculation, 'QUEUED');
  result = await call('/api/v1/students/me/visibility', { method: 'PUT', body: { visible: true, visible_to_universities: true, visible_to_loan_providers: false, visible_to_consultants: true, blocked_org_ids: [] } });
  assert.equal(result.payload.visible_to_loan_providers, false);
  result = await call('/api/v1/students/me/offers');
  assert.ok(Array.isArray(result.payload.results));

  const form = new FormData();
  form.set('doc_type', 'SOP');
  form.set('file', new Blob(['My statement of purpose'], { type: 'text/plain' }), 'sop.txt');
  result = await call('/api/v1/students/me/documents', { method: 'POST', form });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.verification_status, 'PENDING');
  const documentId = result.payload.id;
  result = await call('/api/v1/students/me/documents');
  assert.ok(result.payload.total_results >= 2);
  result = await call(`/api/v1/students/me/documents/${documentId}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);

  const createInvitation = async () => {
    const created = await call('/api/v1/university/invitations', {
      method: 'POST',
      body: { student_id: 1, offer: { offer_type: 'ADMISSION', terms: { scholarship_percent: 40, program_id: programId }, value_summary: '40% tuition scholarship' } }
    });
    assert.equal(created.response.status, 201);
    return created.payload.invitation_id;
  };

  const negotiationId = await createInvitation();
  result = await call(`/api/v1/invitations/${negotiationId}`);
  assert.equal(result.payload.status, 'SENT');
  result = await call(`/api/v1/invitations/${negotiationId}/view`, { method: 'POST' });
  assert.equal(result.payload.status, 'VIEWED');
  result = await call(`/api/v1/invitations/${negotiationId}/negotiate`, { method: 'POST', body: { message: 'Can the scholarship be increased?', proposed_terms: { scholarship_percent: 50 } } });
  assert.equal(result.payload.status, 'NEGOTIATING');
  result = await call(`/api/v1/invitations/${negotiationId}/negotiate/respond`, { method: 'POST', body: { message: 'We can revise it to 45%.', revised_terms: { scholarship_percent: 45 }, hold_firm: false } });
  assert.equal(result.payload.status, 'NEGOTIATING');
  result = await call(`/api/v1/invitations/${negotiationId}/history`);
  assert.ok(result.payload.history.length >= 2);

  const acceptedId = await createInvitation();
  result = await call(`/api/v1/invitations/${acceptedId}/accept`, { method: 'POST' });
  assert.equal(result.payload.status, 'ACCEPTED');
  const rejectedId = await createInvitation();
  result = await call(`/api/v1/invitations/${rejectedId}/reject`, { method: 'POST' });
  assert.equal(result.payload.status, 'REJECTED');
  const withdrawnId = await createInvitation();
  result = await call(`/api/v1/invitations/${withdrawnId}/withdraw`, { method: 'POST' });
  assert.equal(result.payload.status, 'WITHDRAWN');

  result = await call('/api/v1/university/invitations');
  assert.ok(result.payload.total_results >= 4);
  result = await call('/api/v1/students/me/invitations');
  assert.ok(result.payload.total_results >= 4);
  result = await call('/api/v1/university/reports/funnel?period=30d');
  assert.equal(result.payload.period, '30d');
});
