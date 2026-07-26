import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { offers as mockOffers, students as mockStudents } from './data.js';

export class SuperOfferRepository {
  constructor({ connectionString = process.env.MONGODB_URI, logger = console } = {}) {
    this.logger = logger;
    this.client = connectionString
      ? new MongoClient(connectionString, { maxPoolSize: Number(process.env.DATABASE_POOL_SIZE) || 10 })
      : null;
    this.databaseName = process.env.MONGODB_DATABASE || 'superoffer';
    this.mode = this.client ? 'mongodb' : 'mock';
    this.connected = false;
  }

  async database() {
    if (!this.client) return null;
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
    return this.client.db(this.databaseName);
  }

  async checkConnection() {
    if (!this.client) return { connected: false, mode: 'mock' };
    const database = await this.database();
    await database.command({ ping: 1 });
    return { connected: true, mode: 'mongodb', database: this.databaseName };
  }

  async searchStudents({ country, query, sort = 'MATCH_SCORE', page = 1, pageSize = 25 }) {
    if (!this.client) {
      const term = query.toLowerCase();
      return mockStudents
        .filter(student => !country || student.location.includes(country))
        .filter(student => !term || `${student.name} ${student.program} ${student.skills.join(' ')}`.toLowerCase().includes(term))
        .sort((a, b) => sort === 'NAME' ? a.name.localeCompare(b.name) : b.score - a.score)
        .slice((page - 1) * pageSize, page * pageSize);
    }
    const database = await this.database();
    const filter = {};
    if (country) filter.location = { $regex: country, $options: 'i' };
    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { program: { $regex: query, $options: 'i' } },
        { skills: { $elemMatch: { $regex: query, $options: 'i' } } }
      ];
    }
    return database.collection('students')
      .find(filter, { projection: { _id: 0 } })
      .sort(sort === 'NAME' ? { name: 1 } : { score: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
  }

  async countStudents({ country, query }) {
    if (!this.client) {
      const term = query.toLowerCase();
      return mockStudents.filter(student =>
        (!country || student.location.includes(country)) &&
        (!term || `${student.name} ${student.program} ${student.skills.join(' ')}`.toLowerCase().includes(term))
      ).length;
    }
    const database = await this.database();
    const filter = {};
    if (country) filter.location = { $regex: country, $options: 'i' };
    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { program: { $regex: query, $options: 'i' } },
        { skills: { $elemMatch: { $regex: query, $options: 'i' } } }
      ];
    }
    return database.collection('students').countDocuments(filter);
  }

  async getShortlistedStudents() {
    if (!this.client) return mockStudents.filter(student => student.shortlisted);
    const database = await this.database();
    return database.collection('students')
      .find({ shortlisted: true }, { projection: { _id: 0 } })
      .sort({ score: -1 })
      .toArray();
  }

  async getStudent(studentId) {
    if (!this.client) return mockStudents.find(student => student.id === studentId) || null;
    const database = await this.database();
    return database.collection('students').findOne({ id: studentId }, { projection: { _id: 0 } });
  }

  async getStudentOffers(studentId) {
    if (!this.client) return mockOffers.filter(offer => offer.student_id === studentId);
    const database = await this.database();
    return database.collection('admission_offers')
      .find({ student_id: studentId }, { projection: { _id: 0 } })
      .sort({ sent_at: -1 })
      .toArray();
  }

  async setShortlisted(studentId, shortlisted) {
    if (!this.client) {
      const student = mockStudents.find(item => item.id === studentId);
      if (!student) return null;
      student.shortlisted = shortlisted;
      return student;
    }
    const database = await this.database();
    return database.collection('students').findOneAndUpdate(
      { id: studentId },
      { $set: { shortlisted, updated_at: new Date() } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  async listOffers() {
    if (!this.client) {
      return mockOffers.map(offer => ({ ...offer, student: mockStudents.find(student => student.id === offer.student_id) }));
    }
    const database = await this.database();
    return database.collection('admission_offers').aggregate([
      { $sort: { sent_at: -1 } },
      { $lookup: { from: 'students', localField: 'student_id', foreignField: 'id', as: 'students' } },
      { $set: { student: { $first: '$students' } } },
      { $unset: ['_id', 'students', 'student._id'] }
    ]).toArray();
  }

  async createOffer({ studentId, program, offerType, award, responseDeadline }) {
    if (!this.client) {
      const student = mockStudents.find(item => item.id === studentId);
      if (!student) return null;
      const offer = { id: crypto.randomUUID(), student_id: studentId, program, offer_type: offerType, award, response_deadline: responseDeadline, status: 'SENT', sent_at: new Date().toISOString() };
      mockOffers.unshift(offer);
      return { ...offer, student };
    }
    const database = await this.database();
    const student = await database.collection('students').findOne({ id: studentId }, { projection: { _id: 0 } });
    if (!student) return null;
    const offer = {
      id: crypto.randomUUID(),
      student_id: studentId,
      program,
      offer_type: offerType,
      award,
      response_deadline: new Date(responseDeadline),
      status: 'SENT',
      sent_at: new Date(),
      updated_at: new Date()
    };
    await database.collection('admission_offers').insertOne(offer);
    delete offer._id;
    return { ...offer, student };
  }

  async close() {
    await this.client?.close();
  }
}
