import { MongoClient } from 'mongodb';

export class MongoUserStore {
  constructor(connectionString, databaseName = 'superoffer') {
    const serverSelectionTimeoutMS =
      Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 5_000;
    this.client = new MongoClient(connectionString, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS
    });
    this.databaseName = databaseName;
    this.users = null;
    this.studentProfiles = null;
  }

  async connect() {
    await this.client.connect();
    this.users = this.client.db(this.databaseName).collection('users');
    this.studentProfiles = this.client.db(this.databaseName).collection('student_profiles');
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.users.createIndex({ id: 1 }, { unique: true });
    await this.studentProfiles.createIndex({ userId: 1 }, { unique: true });
    return this;
  }

  async findByEmail(email) {
    return this.users.findOne({ email }, { projection: { _id: 0 } });
  }

  async findById(id) {
    return this.users.findOne({ id }, { projection: { _id: 0 } });
  }

  async findInstitutionsByApprovalStatus(approvalStatus) {
    const query = {
      role: { $in: ['UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT'] },
      ...(approvalStatus ? { approvalStatus } : {})
    };
    return this.users.find(query, {
      projection: { _id: 0, passwordHash: 0 }
    }).sort({ createdAt: -1 }).toArray();
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
    const profile = await this.studentProfiles.findOne({ userId }, { projection: { _id: 0 } });
    if (profile) return profile;
    return this.client.db(this.databaseName).collection('students')
      .findOne({ $or: [{ userId }, { user_id: userId }] }, { projection: { _id: 0 } });
  }

  async upsertStudentProfile(userId, profile) {
    await this.studentProfiles.replaceOne({ userId }, { ...profile, userId }, { upsert: true });
    return structuredClone({ ...profile, userId });
  }

  async updateStudentProfileSection(userId, section, value) {
    const now = new Date().toISOString();
    await this.studentProfiles.updateOne(
      { userId },
      { $set: { [section]: value, updatedAt: now }, $setOnInsert: { userId, documents: [], createdAt: now } },
      { upsert: true }
    );
    return this.findStudentProfile(userId);
  }

  async addStudentDocument(userId, document) {
    const now = new Date().toISOString();
    await this.studentProfiles.updateOne(
      { userId },
      { $push: { documents: document }, $set: { updatedAt: now }, $setOnInsert: { userId, createdAt: now } },
      { upsert: true }
    );
    return this.findStudentProfile(userId);
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
