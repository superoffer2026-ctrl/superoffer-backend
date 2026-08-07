import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import {
  Body, Controller, Delete, Get, Param, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { DocumentsService } from './documents.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'student-documents');

const fileInterceptor = () => FileInterceptor('file', {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, callback) => {
      callback(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

@ApiTags('student-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
@Controller('students/me/documents')
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.list(user.id);
  }

  @Post()
  @UseInterceptors(fileInterceptor())
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('documentType') documentType: string
  ) {
    return this.documents.save(user.id, documentType || 'general', file);
  }

  @Put(':id')
  @UseInterceptors(fileInterceptor())
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.documents.replace(user.id, id, file);
  }

  @Get(':id/preview')
  async preview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() response: Response) {
    const document = await this.documents.findOwned(user.id, id);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${document.fileName.replace(/"/g, '')}"`);
    response.sendFile(document.storagePath);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.remove(user.id, id);
  }
}
