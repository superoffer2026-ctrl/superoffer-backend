import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../app.js';

let server;
let baseUrl;

const json = async (path, { method = 'GET', token = '', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: response.status === 204 ? null : await response.json() };
};

const registerAndLogin = async (email) => {
  await json('/api/v1/auth/register', { method: 'POST', body: { email, password: 'ProfilePass2026', role: 'STUDENT', full_name: 'Profile Student' } });
  return (await json('/api/v1/auth/login', { method: 'POST', body: { identifier: email, password: 'ProfilePass2026' } })).body.access_token;
};

const upload = async (token, documentType, file, id = '') => {
  const form = new FormData();
  if (!id) form.append('documentType', documentType);
  form.append('file', file);
  const response = await fetch(`${baseUrl}/api/v1/student/profile/documents${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  return { response, body: await response.json() };
};

before(async () => {
  const created = createApp({ tokenSecret: 'student-profile-test-secret-32-characters' });
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('completes the authenticated student profile and document lifecycle', async () => {
  const token = await registerAndLogin('profile.lifecycle@superoffer.test');
  const otherToken = await registerAndLogin('profile.other@superoffer.test');

  const created = await json('/api/v1/student/profile', { method: 'POST', token, body: { studyLevel: 'UG' } });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.status, 'DRAFT');

  const updated = await json('/api/v1/student/profile', {
    method: 'PATCH', token,
    body: {
      basic: { firstName: 'Aarav', lastName: 'Mehta', email: 'profile.lifecycle@superoffer.test', mobile: '+91 98765 43210', dateOfBirth: '2007-02-18', country: 'India' },
      studyLevel: 'UG',
      academic: { schoolName: 'Northbridge School', board: 'CBSE', currentGrade: 'Grade 12', tenthScore: '94%', twelfthScore: '92% expected', passingYear: '2027' },
      preferences: { course: 'Computer Science', countries: ['United Kingdom', 'Canada'], intake: ['Fall 2027'] },
      selectedTests: ['Not Yet'],
      achievements: { selected: ['Coding', 'Robotics'], story: 'Built an accessibility app.' },
      links: { github: 'https://github.com/student', linkedin: '', portfolio: '' }
    }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.studyLevel, 'UG');

  const financial = await json('/api/v1/student/profile/financial', {
    method: 'PUT', token,
    body: { fundingPreference: 'Combination', estimatedAnnualBudget: 'USD 20,000–30,000', interestedInScholarships: true, preferLowerTuition: true, needFinancialAssistance: true }
  });
  assert.equal(financial.response.status, 200);
  assert.equal(financial.body.fundingPreference, 'Combination');

  const first = await upload(token, '10th Mark Sheet', new File(['grade ten'], 'grade-10.pdf', { type: 'application/pdf' }));
  assert.equal(first.response.status, 201);
  const second = await upload(token, '12th Mark Sheet / Latest Marks', new File(['grade twelve'], 'grade-12.png', { type: 'image/png' }));
  assert.equal(second.response.status, 201);

  const listed = await json('/api/v1/student/profile/documents', { token });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.total, 2);

  const content = await fetch(`${baseUrl}/api/v1/student/profile/documents/${first.body.id}/content`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(content.status, 200);
  assert.equal(await content.text(), 'grade ten');

  const protectedContent = await fetch(`${baseUrl}/api/v1/student/profile/documents/${first.body.id}/content`, { headers: { authorization: `Bearer ${otherToken}` } });
  assert.equal(protectedContent.status, 404);

  const replacement = await upload(token, '', new File(['replacement'], 'grade-10-new.jpg', { type: 'image/jpeg' }), first.body.id);
  assert.equal(replacement.response.status, 200);
  assert.notEqual(replacement.body.id, first.body.id);

  const invalidType = await upload(token, 'Passport', new File(['bad'], 'malware.txt', { type: 'text/plain' }));
  assert.equal(invalidType.response.status, 415);
  assert.equal(invalidType.body.code, 'UNSUPPORTED_FILE_TYPE');

  const completion = await json('/api/v1/student/profile/completion', { token });
  assert.equal(completion.response.status, 200);
  assert.equal(completion.body.percent, 100);
  assert.equal(completion.body.readyToSubmit, true);

  const submitted = await json('/api/v1/student/profile/submit', { method: 'POST', token, body: {} });
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.status, 'SUBMITTED');
  assert.ok(submitted.body.submittedAt);

  const removed = await json(`/api/v1/student/profile/documents/${replacement.body.id}`, { method: 'DELETE', token });
  assert.equal(removed.response.status, 204);
  const afterDelete = await json('/api/v1/student/profile/documents', { token });
  assert.equal(afterDelete.body.total, 1);
});
