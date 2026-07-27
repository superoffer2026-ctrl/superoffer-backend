export class InMemoryUserStore {
  constructor() {
    this.usersByEmail = new Map();
  }

  async findByEmail(email) {
    return this.usersByEmail.get(email) || null;
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
}
