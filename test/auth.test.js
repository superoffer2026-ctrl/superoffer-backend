import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

const request = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
};

before(async () => {
  const created = createApp({ tokenSecret: 'test-secret-with-more-than-32-characters' });
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('registers a university officer and rejects duplicate email', async () => {
  const registration = await request('/api/v1/auth/register', {
    email: 'maya.chen@northbridge.edu',
    password: 'password123',
    role: 'UNIVERSITY_OFFICER'
  });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.body.user_id);
  assert.equal(registration.body.otp_required, true);

  const duplicate = await request('/api/v1/auth/register', {
    email: 'MAYA.CHEN@northbridge.edu',
    password: 'password123',
    role: 'UNIVERSITY_OFFICER'
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('serves Swagger UI and the OpenAPI document', async () => {
  const documentResponse = await fetch(`${baseUrl}/api-docs.json`);
  const document = await documentResponse.json();
  assert.equal(documentResponse.status, 200);
  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/api/v1/auth/register']);
  assert.ok(document.paths['/api/v1/auth/login']);
  assert.ok(document.paths['/api/v1/students/me']);
  assert.ok(document.paths['/api/v1/students/me/offers']);

  const uiResponse = await fetch(`${baseUrl}/api-docs/`);
  assert.equal(uiResponse.status, 200);
  assert.match(await uiResponse.text(), /SuperOffer API Documentation/);
});

test('returns the student portal profile and offers expected by the frontend', async () => {
  const profileResponse = await fetch(`${baseUrl}/api/v1/students/me`);
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.name, 'Aarav Mehta');
  assert.equal(profile.completion_percent, 82);
  assert.ok(Array.isArray(profile.preferences.target_countries));

  const offersResponse = await fetch(`${baseUrl}/api/v1/students/me/offers`);
  const offers = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.equal(offers.total_results, 1);
  assert.equal(offers.results[0].institution, 'Northbridge University');
  assert.equal(offers.results[0].status_label, 'Pending');
});

test('validates registration email, password, and public role', async () => {
  const invalidEmail = await request('/api/v1/auth/register', {
    email: 'not-an-email',
    password: 'password123',
    role: 'UNIVERSITY_OFFICER'
  });
  assert.equal(invalidEmail.response.status, 400);

  const weakPassword = await request('/api/v1/auth/register', {
    email: 'officer@westford.edu',
    password: 'password',
    role: 'UNIVERSITY_OFFICER'
  });
  assert.equal(weakPassword.response.status, 400);
  assert.equal(weakPassword.body.code, 'WEAK_PASSWORD');

  const admin = await request('/api/v1/auth/register', {
    email: 'admin@superoffer.net',
    password: 'password123',
    role: 'SUPER_ADMIN'
  });
  assert.equal(admin.response.status, 400);
  assert.equal(admin.body.code, 'INVALID_ROLE');
});

test('logs in with valid credentials and returns access and refresh tokens', async () => {
  const login = await request('/api/v1/auth/login', {
    identifier: 'maya.chen@northbridge.edu',
    password: 'password123'
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.role, 'UNIVERSITY_OFFICER');
  assert.equal(login.body.expires_in, 3600);
  assert.equal(login.body.access_token.split('.').length, 3);
  assert.equal(login.body.refresh_token.split('.').length, 3);
});

test('rejects invalid credentials without revealing whether an email exists', async () => {
  const wrongPassword = await request('/api/v1/auth/login', {
    identifier: 'maya.chen@northbridge.edu',
    password: 'wrong-password1'
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.equal(wrongPassword.body.code, 'INVALID_CREDENTIALS');

  const missingUser = await request('/api/v1/auth/login', {
    identifier: 'missing@northbridge.edu',
    password: 'wrong-password1'
  });
  assert.equal(missingUser.response.status, 401);
  assert.equal(missingUser.body.code, 'INVALID_CREDENTIALS');
  assert.equal(missingUser.body.message, wrongPassword.body.message);
});

test('locks an account after five failed login attempts', async () => {
  await request('/api/v1/auth/register', {
    email: 'locked@northbridge.edu',
    password: 'password123',
    role: 'UNIVERSITY_OFFICER'
  });

  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = await request('/api/v1/auth/login', {
      identifier: 'locked@northbridge.edu',
      password: 'incorrect1'
    });
  }
  assert.equal(result.response.status, 423);
  assert.equal(result.body.code, 'ACCOUNT_LOCKED');
  assert.ok(result.body.retry_after_seconds > 0);
});
