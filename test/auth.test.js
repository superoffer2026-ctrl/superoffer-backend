import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../app.js';

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

test('serves backend information at the root URL', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'superoffer-backend');
  assert.equal(body.api_base, '/api/v1');
  assert.equal(body.health, '/health');
  assert.equal(body.documentation, '/api-docs');
});

test('allows registration requests from the production frontend origins', async () => {
  for (const origin of ['https://superoffer.net', 'https://www.superoffer.net']) {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  }
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

  const blockedOffersResponse = await fetch(`${baseUrl}/api/v1/students/me/offers`, { headers: authHeaders });
  assert.equal(blockedOffersResponse.status, 409);

  const savedProfileResponse = await fetch(`${baseUrl}/api/v1/students/me`, {
    method: 'PUT',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      date_of_birth: '2002-06-12',
      nationality: 'Indian',
      location: 'Mumbai, India',
      academic_records: [{ institution_name: 'Mumbai Institute', qualification: 'B.Tech Computer Science', score_raw: '8.8 / 10', graduation_year: 2025 }],
      test_scores: [{ test_type: 'IELTS', score: '7.5' }],
      preferences: {
        target_countries: ['Canada'],
        target_courses: ['Data Science'],
        degree_level: 'Masters',
        intake_term: 'Fall 2027',
        budget_band: '₹25–40 lakh',
        scholarship_need: true
      },
      financial: { funding_source: 'Education loan' },
      visibility: { visible: true, visible_to_universities: true, visible_to_loan_providers: true }
    })
  });
  const savedProfile = await savedProfileResponse.json();
  assert.equal(savedProfileResponse.status, 200);
  assert.equal(savedProfile.profile_complete, true);
  assert.equal(savedProfile.completion_percent, 100);

  const offersResponse = await fetch(`${baseUrl}/api/v1/students/me/offers`, { headers: authHeaders });
  const offers = await offersResponse.json();
  assert.equal(offersResponse.status, 200);
  assert.equal(offers.total_results, 0);
  assert.equal(offers.source, 'mongodb');
});

test('saves all student profile sections independently and calculates weighted completion', async () => {
  await request('/api/v1/auth/register', {
    email: 'nine.step.student@example.com',
    password: 'password123',
    role: 'STUDENT',
    full_name: 'Nine Step Student'
  });
  const login = await request('/api/v1/auth/login', {
    identifier: 'nine.step.student@example.com',
    password: 'password123'
  });
  const headers = { authorization: `Bearer ${login.body.access_token}`, 'content-type': 'application/json' };
  const save = (section, body) => fetch(`${baseUrl}/api/student/profile/${section}`, {
    method: 'PUT', headers, body: JSON.stringify(body)
  });

  let response = await save('personal', {
    firstName:'Nine', lastName:'Student', profilePhoto:'', dateOfBirth:'2003-04-10', gender:'Female',
    nationality:'Indian', country:'India', state:'Tamil Nadu', city:'Chennai', address:'Anna Nagar',
    phoneNumber:'+919876543210', passportStatus:'Available', passportNumber:'P1234567', shortBio:'Aspiring data scientist.'
  });
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.profileCompletionPercentage, 20);

  response = await save('education', {
    studentType:'COLLEGE', graduationYear:2027,
    college:{ collegeName:'Madras College', university:'State University', degree:'B.Tech', department:'Computer Science', cgpa:8.7, currentSemester:'6', numberOfBacklogs:0, projects:['ML project'], internships:['Data internship'], academicAchievements:['Dean list'] }
  });
  assert.equal(response.status, 200);
  response = await save('preferences', {
    preferredCountries:['Canada','UK'], preferredCourses:['Data Science'], degreeType:'Masters',
    preferredIntake:'Fall 2027', budgetRange:'₹25–40 lakh', scholarshipRequired:true, accommodationRequired:true
  });
  assert.equal(response.status, 200);
  response = await save('exams', { exams:[{ examType:'IELTS', examTaken:true, score:7.5, examDate:'2026-05-01' }] });
  assert.equal(response.status, 200);
  response = await save('skills', {
    technicalSkills:['Python'], softSkills:['Communication'], languagesKnown:['English','Tamil'],
    certifications:[], hackathons:[], competitions:[], volunteerExperience:[], leadershipExperience:[],
    portfolioUrl:'https://example.com', linkedInUrl:'https://linkedin.com/in/student', githubUrl:'https://github.com/student'
  });
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.profileCompletionPercentage, 90);

  const form = new FormData();
  form.append('documentType', 'ACADEMIC_TRANSCRIPT');
  form.append('file', new Blob(['sample transcript'], { type:'application/pdf' }), 'transcript.pdf');
  response = await fetch(`${baseUrl}/api/student/profile/documents`, {
    method:'POST', headers:{ authorization:headers.authorization }, body:form
  });
  body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.data.profile.profileCompletionPercentage, 100);
  assert.equal(body.data.profile.profileComplete, true);

  response = await fetch(`${baseUrl}/api/student/profile/completion`, { headers:{ authorization:headers.authorization } });
  body = await response.json();
  assert.equal(body.data.profileCompletionPercentage, 100);
  assert.equal(body.data.sections.documents, true);
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

test('lists pending institution registrations for an authorized admin', async () => {
  const pendingEmail = 'approval.queue@northbridge.edu';
  const registration = await request('/api/v1/auth/register', institutionRegistration({
    email: pendingEmail
  }));
  assert.equal(registration.response.status, 201);

  const response = await fetch(`${baseUrl}/api/v1/admin/registrations?status=PENDING`, {
    headers: { 'x-admin-key': 'test-admin-key' }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.registrations.some(item => item.email === pendingEmail));
  assert.ok(body.registrations.every(item => !('passwordHash' in item)));
});

test('filters institution queues and records approval decisions in the append-only audit log', async () => {
  const registration = await request('/api/v1/auth/register', institutionRegistration({
    email:'bank.review@example.com',
    role:'LOAN_OFFICER',
    organization:{ name:'Review Bank', registration_number:'BANK-100', license_reference:'RBI-200' }
  }));
  assert.equal(registration.response.status, 201);

  let response = await fetch(`${baseUrl}/api/v1/admin/registrations?status=PENDING&org_type=BANK`, {
    headers:{ 'x-admin-key':'test-admin-key' }
  });
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.registrations.some(item => item.email === 'bank.review@example.com'));
  assert.ok(body.registrations.every(item => item.role === 'LOAN_OFFICER'));
  assert.ok(body.summary.banks >= 1);

  response = await fetch(`${baseUrl}/api/v1/admin/users/${registration.body.user_id}/approval`, {
    method:'PATCH',
    headers:{ 'content-type':'application/json', 'x-admin-key':'test-admin-key' },
    body:JSON.stringify({ approval_status:'REJECTED' })
  });
  body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'REJECTION_REASON_REQUIRED');

  response = await fetch(`${baseUrl}/api/v1/admin/users/${registration.body.user_id}/approval`, {
    method:'PATCH',
    headers:{ 'content-type':'application/json', 'x-admin-key':'test-admin-key' },
    body:JSON.stringify({ approval_status:'REJECTED', rejection_reason:'Licence could not be verified' })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/v1/admin/audit-log`, { headers:{ 'x-admin-key':'test-admin-key' } });
  body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.entries.some(entry => entry.entityId === registration.body.user_id && entry.action === 'VERIFICATION_REJECTED'));
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

  const portalProfile = await fetch(`${baseUrl}/api/v1/student/profile`, {
    headers: { authorization: `Bearer ${login.body.access_token}` }
  });
  const portalProfileBody = await portalProfile.json();
  assert.equal(portalProfile.status, 200);
  assert.equal(portalProfileBody.success, true);
  assert.equal(portalProfileBody.data.userId, registration.body.user_id);
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
