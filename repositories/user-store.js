export class InMemoryUserStore {
  constructor() {
    this.usersByEmail = new Map();
    this.studentProfiles = new Map();
  }

  async findByEmail(email) {
    return this.usersByEmail.get(email) || null;
  }

  async findById(id) {
    return [...this.usersByEmail.values()].find(user => user.id === id) || null;
  }

  async findInstitutionsByApprovalStatus(approvalStatus) {
    return [...this.usersByEmail.values()]
      .filter(user => user.role !== 'STUDENT' && (!approvalStatus || user.approvalStatus === approvalStatus))
      .map(user => structuredClone(user));
  }

  async insert(user) {
    if (this.usersByEmail.has(user.email)) return null;
    this.usersByEmail.set(user.email, structuredClone(user));
    return structuredClone(user);
  }

  async update(user) {
    this.usersByEmail.set(user.email, structuredClone(user));
    return structuredClone(user);
  }

  async findStudentProfile(userId) {
    return structuredClone(this.studentProfiles.get(userId) || null);
  }

  async upsertStudentProfile(userId, profile) {
    this.studentProfiles.set(userId, structuredClone(profile));
    return structuredClone(profile);
  }

  async findStudentOffers() {
    return [];
  }
}
