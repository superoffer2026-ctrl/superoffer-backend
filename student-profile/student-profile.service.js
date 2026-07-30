import { completionFor } from './student-profile.validation.js';
import { createStudentProfileModel } from './student-profile.model.js';

export class StudentProfileService {
  constructor(userStore, documentStorage) {
    this.userStore = userStore;
    this.documentStorage = documentStorage;
  }

  async get(userId) {
    const profile = await this.userStore.findStudentProfile(userId);
    const documents = await this.documentStorage.list(userId);
    const clean = profile || { userId, status: 'DRAFT', createdAt: null, updatedAt: null };
    return { ...clean, documents, completion: completionFor(clean, documents) };
  }

  async create(userId, payload) {
    const existing = await this.userStore.findStudentProfile(userId);
    if (existing) return null;
    const profile = createStudentProfileModel({ userId, payload });
    await this.userStore.upsertStudentProfile(userId, profile);
    return this.get(userId);
  }

  async update(userId, payload) {
    const current = await this.userStore.findStudentProfile(userId);
    const profile = createStudentProfileModel({ userId, payload, existing: current });
    await this.userStore.upsertStudentProfile(userId, profile);
    return this.get(userId);
  }

  async financial(userId, payload) {
    return this.update(userId, { financial: payload });
  }

  async syncDocuments(userId) {
    const documents = await this.documentStorage.list(userId);
    await this.update(userId, { documentReferences: documents.map(({ id, documentType, fileName, mimeType, size, uploadedAt }) => ({ id, documentType, fileName, mimeType, size, uploadedAt })) });
    return documents;
  }

  async submit(userId) {
    const current = await this.get(userId);
    if (!current.completion.readyToSubmit) return { profile: current, submitted: false };
    const profile = { ...current };
    delete profile.documents;
    delete profile.completion;
    profile.status = 'SUBMITTED';
    profile.submittedAt = new Date().toISOString();
    profile.updatedAt = profile.submittedAt;
    await this.userStore.upsertStudentProfile(userId, profile);
    return { profile: await this.get(userId), submitted: true };
  }
}
