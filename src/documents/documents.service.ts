import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async save(userId: string, documentType: string, file: Express.Multer.File) {
    return this.prisma.studentDocument.create({
      data: {
        userId,
        documentType,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storagePath: file.path
      }
    });
  }

  list(userId: string) {
    return this.prisma.studentDocument.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' }
    });
  }

  async remove(userId: string, id: string) {
    const doc = await this.prisma.studentDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();

    await this.prisma.studentDocument.delete({ where: { id } });
    await unlink(doc.storagePath).catch(() => undefined);
    return { id, deleted: true };
  }
}
