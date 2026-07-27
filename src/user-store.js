export class InMemoryUserStore {
  constructor() {
    this.usersByEmail = new Map();
  }

  async findByEmail(email) {
    return this.usersByEmail.get(email) || null;
  }

  async findById(id) {
    return [...this.usersByEmail.values()].find(user => user.id === id) || null;
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

  async findStudentProfile() {
    return null;
  }

  async findStudentOffers() {
    return [];
  }
}
