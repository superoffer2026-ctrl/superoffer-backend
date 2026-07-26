import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let repository;

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

test('health endpoint reports a healthy service', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, 'superoffer-backend');
});

test('university search returns ranked student matches', async () => {
  const response = await fetch(`${baseUrl}/api/v1/university/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sort: 'MATCH_SCORE', page: 1, page_size: 5 })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results.length, 5);
  assert.equal(body.results[0].name, 'Aarav Mehta');
  assert.equal(body.source, 'superoffer-api');
});

test('offer endpoint validates and creates an admission offer', async () => {
  const invalid = await fetch(`${baseUrl}/api/v1/university/offers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ student_id: 1 })
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${baseUrl}/api/v1/university/offers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      student_id: 1,
      program: 'MSc Data Science',
      offer_type: 'CONDITIONAL_ADMISSION',
      response_deadline: '2026-08-15',
      award: '30% Global Excellence Scholarship'
    })
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, 'SENT');
});
