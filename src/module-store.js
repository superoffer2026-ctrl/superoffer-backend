import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const clone = value => structuredClone(value);

const initialState = () => ({
  university_org: [{
    id: 'university-northbridge',
    name: 'Northbridge University',
    type: 'PRIVATE',
    verification_status: 'VERIFIED',
    official_domain: 'northbridge.edu',
    accreditation_doc_url: '/documents/northbridge-accreditation.pdf',
    campuses: [{ id: 'campus-toronto', name: 'Toronto Campus', location: 'Toronto, Canada' }]
  }],
  university_programs: [
    { id: 'program-data-science', name: 'MSc Data Science', degree_level: 'Masters', intake_terms: ['Fall 2027'], seats_available: 45 },
    { id: 'program-ai', name: 'MSc Artificial Intelligence', degree_level: 'Masters', intake_terms: ['Fall 2027'], seats_available: 30 }
  ],
  university_offer_templates: [
    { id: 'template-global-excellence', name: 'Global Excellence', default_terms: { scholarship_percent: 30, fee_waiver: false, fast_track: true } }
  ],
  university_admission_criteria: [{
    id: 'criteria-default',
    program_id: 'program-data-science',
    min_score: 70,
    preferred_curricula: ['Computer Science', 'Engineering'],
    criteria_weights: { academics: 35, exams: 25, skills: 25, financial_fit: 15 }
  }],
  student_profiles: [{
    id: 1,
    first_name: 'Aarav',
    last_name: 'Mehta',
    date_of_birth: '2003-04-18',
    nationality: 'Indian',
    completion_percent: 92,
    academic_records: [{ institution_name: 'National Institute of Technology', grading_system: '10_POINT', score_raw: '8.8', graduation_year: 2025 }],
    test_scores: [{ test_type: 'IELTS', score: '8.0', test_date: '2026-02-12' }],
    preferences: { target_countries: ['CA', 'UK'], target_courses: ['Data Science', 'Artificial Intelligence'], degree_level: 'Masters', intake_term: 'Fall 2027', budget_band: '25000-35000 USD', scholarship_need: true },
    visibility: { visible: true, visible_to_universities: true, visible_to_loan_providers: true, visible_to_consultants: true, blocked_org_ids: [] }
  }],
  student_documents: [
    { id: 'document-transcript-1', student_id: 1, doc_type: 'TRANSCRIPT', file_name: 'aarav-transcript.pdf', file_url: '/uploads/aarav-transcript.pdf', verification_status: 'VERIFIED', created_at: now() }
  ],
  shortlists: [{
    id: 'shortlist-fall-2027',
    name: 'Fall 2027 priority candidates',
    items: [{ student_id: 2, added_at: now() }],
    created_at: now()
  }],
  invitations: []
});

export class ModuleStore {
  constructor(repository) {
    this.repository = repository;
    this.memory = initialState();
  }

  async collection(name) {
    if (!this.repository.client) return null;
    const database = await this.repository.database();
    return database.collection(name);
  }

  async ensureSeeded(name, collection) {
    if (!collection || !this.memory[name]?.length) return;
    if (await collection.estimatedDocumentCount() === 0) {
      await collection.insertMany(clone(this.memory[name]));
    }
  }

  async list(name, filter = {}) {
    const collection = await this.collection(name);
    if (collection) {
      await this.ensureSeeded(name, collection);
      return collection.find(filter, { projection: { _id: 0 } }).toArray();
    }
    return clone((this.memory[name] || []).filter(item =>
      Object.entries(filter).every(([key, value]) => item[key] === value)
    ));
  }

  async get(name, filter) {
    const collection = await this.collection(name);
    if (collection) {
      await this.ensureSeeded(name, collection);
      return collection.findOne(filter, { projection: { _id: 0 } });
    }
    const item = (this.memory[name] || []).find(entry => Object.entries(filter).every(([key, value]) => entry[key] === value));
    return item ? clone(item) : null;
  }

  async insert(name, value) {
    const document = { id: value.id || crypto.randomUUID(), ...value, created_at: value.created_at || now(), updated_at: now() };
    const collection = await this.collection(name);
    if (collection) {
      await collection.insertOne(document);
      delete document._id;
    } else {
      this.memory[name] ||= [];
      this.memory[name].push(clone(document));
    }
    return clone(document);
  }

  async update(name, filter, changes) {
    const collection = await this.collection(name);
    if (collection) {
      return collection.findOneAndUpdate(filter, { $set: { ...changes, updated_at: new Date() } }, { returnDocument: 'after', projection: { _id: 0 } });
    }
    const item = (this.memory[name] || []).find(entry => Object.entries(filter).every(([key, value]) => entry[key] === value));
    if (!item) return null;
    Object.assign(item, clone(changes), { updated_at: now() });
    return clone(item);
  }

  async remove(name, filter) {
    const collection = await this.collection(name);
    if (collection) return (await collection.deleteOne(filter)).deletedCount > 0;
    const index = (this.memory[name] || []).findIndex(entry => Object.entries(filter).every(([key, value]) => entry[key] === value));
    if (index < 0) return false;
    this.memory[name].splice(index, 1);
    return true;
  }

  async updateInvitation(id, targetStatus, extra = {}) {
    const invitation = await this.get('invitations', { id });
    if (!invitation) return null;
    const terminal = ['ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'];
    if (terminal.includes(invitation.status)) return { terminal: true, invitation };
    const history = invitation.history || [];
    history.push({ from_status: invitation.status, to_status: targetStatus, changed_at: now() });
    const updated = await this.update('invitations', { id }, { status: targetStatus, history, ...extra });
    return { terminal: false, invitation: updated };
  }
}
