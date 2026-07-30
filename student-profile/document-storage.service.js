import crypto from 'node:crypto';
import { GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'node:stream';

export class DocumentStorageService {
  constructor(userStore) {
    this.memory = new Map();
    this.bucket = userStore.client
      ? new GridFSBucket(userStore.client.db(userStore.databaseName), { bucketName: 'student_documents' })
      : null;
  }

  async save({ userId, documentType, file, previousId = null }) {
    if (previousId) await this.delete(userId, previousId);
    const id = this.bucket ? await this.saveGridFs({ userId, documentType, file }) : crypto.randomUUID();
    const metadata = {
      id: String(id), userId, documentType, fileName: file.originalname,
      mimeType: file.mimetype, size: file.size, uploadedAt: new Date().toISOString()
    };
    if (!this.bucket) this.memory.set(metadata.id, { metadata, buffer: Buffer.from(file.buffer) });
    return metadata;
  }

  async saveGridFs({ userId, documentType, file }) {
    const stream = this.bucket.openUploadStream(file.originalname, {
      contentType: file.mimetype,
      metadata: { userId, documentType, originalName: file.originalname }
    });
    await new Promise((resolve, reject) => {
      Readable.from(file.buffer).pipe(stream).once('finish', resolve).once('error', reject);
    });
    return stream.id;
  }

  async list(userId) {
    if (!this.bucket) return [...this.memory.values()].filter(item => item.metadata.userId === userId).map(item => item.metadata);
    const files = await this.bucket.find({ 'metadata.userId': userId }).sort({ uploadDate: -1 }).toArray();
    return files.map(file => ({
      id: String(file._id), userId, documentType: file.metadata.documentType,
      fileName: file.metadata.originalName || file.filename, mimeType: file.contentType,
      size: file.length, uploadedAt: file.uploadDate.toISOString()
    }));
  }

  async get(userId, id) {
    if (!this.bucket) {
      const item = this.memory.get(id);
      return item?.metadata.userId === userId ? item : null;
    }
    if (!ObjectId.isValid(id)) return null;
    const file = await this.bucket.find({ _id: new ObjectId(id), 'metadata.userId': userId }).next();
    if (!file) return null;
    return {
      metadata: { id, userId, documentType: file.metadata.documentType, fileName: file.metadata.originalName || file.filename, mimeType: file.contentType, size: file.length, uploadedAt: file.uploadDate.toISOString() },
      stream: this.bucket.openDownloadStream(file._id)
    };
  }

  async delete(userId, id) {
    if (!this.bucket) {
      const item = this.memory.get(id);
      if (!item || item.metadata.userId !== userId) return false;
      this.memory.delete(id);
      return true;
    }
    if (!ObjectId.isValid(id)) return false;
    const file = await this.bucket.find({ _id: new ObjectId(id), 'metadata.userId': userId }).next();
    if (!file) return false;
    await this.bucket.delete(file._id);
    return true;
  }
}
