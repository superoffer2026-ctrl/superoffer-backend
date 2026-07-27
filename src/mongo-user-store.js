import { MongoClient } from 'mongodb';

export class MongoUserStore {
  constructor(connectionString, databaseName = 'superoffer') {
    this.client = new MongoClient(connectionString, { maxPoolSize: 10 });
    this.databaseName = databaseName;
    this.users = null;
  }

  async connect() {
    await this.client.connect();
    this.users = this.client.db(this.databaseName).collection('users');
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.users.createIndex({ id: 1 }, { unique: true });
    return this;
  }

  async findByEmail(email) {
    return this.users.findOne({ email }, { projection: { _id: 0 } });
  }

  async findById(id) {
    return this.users.findOne({ id }, { projection: { _id: 0 } });
  }

  async insert(user) {
    try {
      await this.users.insertOne({ ...user });
      return structuredClone(user);
    } catch (error) {
      if (error?.code === 11000) return null;
      throw error;
    }
  }

  async update(user) {
    await this.users.replaceOne({ email: user.email }, { ...user }, { upsert: false });
    return structuredClone(user);
  }

  async findStudentProfile(userId) {
    return this.client.db(this.databaseName).collection('students').findOne(
      { $or: [{ userId }, { user_id: userId }] },
      { projection: { _id: 0 } }
    );
  }

  async findStudentOffers(userId) {
    return this.client.db(this.databaseName).collection('offers').find(
      { $or: [{ studentUserId: userId }, { student_user_id: userId }, { userId }] },
      { projection: { _id: 0 } }
    ).toArray();
  }

  async close() {
    await this.client.close();
  }
}
