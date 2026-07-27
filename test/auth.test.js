import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

const request = async (path, body, { method = 'POST', headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
};

const institutionRegistration = (overrides = {}) => ({
  email: 'maya.chen@northbridge.edu',
  password: 'password123',
  role: 'UNIVERSITY_OFFICER',
  full_name: 'Maya Chen',
  phone: '+1 416 555 0182',
  organization: {
    name: 'Northbridge University',
    registration_number: 'CA-UNI-1984-0081',
    website: 'https://northbridge.edu',
    country: 'Canada',
    city: 'Toronto',
    license_reference: 'ACC-2026-4418'
  },
  ...overrides
});

before(async () => {
  const created = createApp({
    tokenSecret: 'test-secret-with-more-than-32-characters',
    adminApprovalKey: 'test-admin-key'
  });
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
  const registration = await request('/api/v1/auth/register', institutionRegistration());
  assert.equal(registration.response.status, 201);
  assert.ok(registration.body.user_id);
  assert.equal(registration.body.approval_status, 'PENDING');
  assert.equal(registration.body.can_login, false);

  const duplicate = await request('/api/v1/auth/register', institutionRegistration({
    email: 'MAYA.CHEN@northbridge.edu'
  }));
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
  assert.ok(document.paths['/api/v1/auth/status/{userId}']);
  assert.ok(document.paths['/api/v1/admin/users/{userId}/approval']);
  assert.ok(document.paths['/api/v1/students/me']);
  assert.ok(document.paths['/api/v1/students/me/offers']);

  const uiResponse = await fetch(`${baseUrl}/api-docs/`);
  assert.equal(uiResponse.status, 200);
  assert.match(await uiResponse.text(), /SuperOffer API Documentation/);
});

test('returns the student portal profile and offers expected by the frontend', async () => {
  await request('/api/v1/auth/register', {
    email: 'portal.student@example.com',
    password: 'password123',
    role: 'STUDENT',
    full_name: 'Portal Student'
  });
  const login = await request('/api/v1/auth/login', {
    identifier: 'portal.student@example.com',
    password: 'password123'
  });
  const authHeaders = { authorization: `Bearer ${login.body.access_token}` };
  const profileResponse = await fetch(`${baseUrl}/api/v1/students/me`, { headers: authHeaders });
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.name, 'Portal Student');
  assert.equal(profile.source, 'mongodb');
  assert.ok(Array.isArray(profile.preferences.target_countries));

  const offersResponse = await fetch(`${baseUrl}/api/v1/students/me/offers`, { headers: authHeaders });
  const offers = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.equal(offers.total_results, 0);
  assert.equal(offers.source, 'mongodb');
});

test('validates registration email, password, and public role', async () => {
  const invalidEmail = await request('/api/v1/auth/register', {
    email: 'not-an-email',
    password: 'password123',
    role: 'UNIVERSITY_OFFICER',
    full_name: 'Invalid User'
  });
  assert.equal(invalidEmail.response.status, 400);

  const weakPassword = await request('/api/v1/auth/register', {
    email: 'officer@westford.edu',
    password: 'password',
    role: 'UNIVERSITY_OFFICER',
    full_name: 'Westford Officer'
  });
  assert.equal(weakPassword.response.status, 400);
  assert.equal(weakPassword.body.code, 'WEAK_PASSWORD');

  const admin = await request('/api/v1/auth/register', {
    email: 'admin@superoffer.net',
    password: 'password123',
    role: 'SUPER_ADMIN',
    full_name: 'Platform Admin'
  });
  assert.equal(admin.response.status, 400);
  assert.equal(admin.body.code, 'INVALID_ROLE');
});

test('gates institutions until admin approval, then permits login', async () => {
  const pendingLogin = await request('/api/v1/auth/login', {
    identifier: 'maya.chen@northbridge.edu',
    password: 'password123'
  });
  assert.equal(pendingLogin.response.status, 403);
  assert.equal(pendingLogin.body.code, 'ACCOUNT_PENDING_APPROVAL');

  const status = await fetch(`${baseUrl}/api/v1/auth/status/${pendingLogin.body.user_id}`);
  const statusBody = await status.json();
  assert.equal(status.status, 200);
  assert.equal(statusBody.approval_status, 'PENDING');

  const approval = await request(
    `/api/v1/admin/users/${pendingLogin.body.user_id}/approval`,
    { approval_status: 'APPROVED' },
    { method: 'PATCH', headers: { 'x-admin-key': 'test-admin-key' } }
  );
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.can_login, true);

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

test('allows student registration and login without admin approval', async () => {
  const registration = await request('/api/v1/auth/register', {
    email: 'aarav.mehta@email.com',
    password: 'password123',
    role: 'STUDENT',
    full_name: 'Aarav Mehta',
    phone: '+91 98765 43210'
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.approval_status, 'APPROVED');
  assert.equal(registration.body.can_login, true);

  const login = await request('/api/v1/auth/login', {
    identifier: 'aarav.mehta@email.com',
    password: 'password123'
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.role, 'STUDENT');
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
    role: 'STUDENT',
    full_name: 'Locked Student'
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
