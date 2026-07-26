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

test('student portal profile and offers return stable response contracts', async () => {
  const profileResponse = await fetch(`${baseUrl}/api/v1/students/me`);
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.name, 'Aarav Mehta');
  assert.equal(profile.source, 'superoffer-api');

  const offersResponse = await fetch(`${baseUrl}/api/v1/students/me/offers`);
  const offers = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.ok(Array.isArray(offers.results));
  assert.equal(offers.source, 'superoffer-api');
});

test('shortlist list and update endpoints return persisted response shapes', async () => {
  const listResponse = await fetch(`${baseUrl}/api/v1/university/shortlists`);
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.ok(Array.isArray(list.results));

  const updateResponse = await fetch(`${baseUrl}/api/v1/university/shortlists/students/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shortlisted: true })
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updated.id, 1);
  assert.equal(updated.shortlisted, true);

  const invalidResponse = await fetch(`${baseUrl}/api/v1/university/shortlists/students/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shortlisted: 'yes' })
  });
  assert.equal(invalidResponse.status, 400);
});

test('university offers list and unknown routes return documented contracts', async () => {
  const offersResponse = await fetch(`${baseUrl}/api/v1/university/offers`);
  const offers = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.ok(Array.isArray(offers.results));

  const missingResponse = await fetch(`${baseUrl}/api/v1/not-a-route`);
  const missing = await missingResponse.json();
  assert.equal(missingResponse.status, 404);
  assert.equal(missing.code, 'ROUTE_NOT_FOUND');
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
