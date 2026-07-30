export const createStudentProfileModel = ({ userId, payload = {}, existing = null }) => {
  const now = new Date().toISOString();
  return {
    ...(existing || {}),
    ...payload,
    userId,
    status: existing?.status || 'DRAFT',
    basic: { ...(existing?.basic || {}), ...(payload.basic || {}) },
    academic: { ...(existing?.academic || {}), ...(payload.academic || {}) },
    preferences: { ...(existing?.preferences || {}), ...(payload.preferences || {}) },
    achievements: { ...(existing?.achievements || {}), ...(payload.achievements || {}) },
    links: { ...(existing?.links || {}), ...(payload.links || {}) },
    documentReferences: payload.documentReferences || existing?.documentReferences || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    submittedAt: existing?.submittedAt || null
  };
};
