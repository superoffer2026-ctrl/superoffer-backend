import { Router } from 'express';
import multer from 'multer';
import { DocumentStorageService } from './document-storage.service.js';
import { StudentProfileController } from './student-profile.controller.js';
import { StudentProfileService } from './student-profile.service.js';

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error('Only PDF, JPG, JPEG, and PNG files are allowed');
      error.status = 415;
      return callback(error);
    }
    callback(null, true);
  }
});

export const createStudentProfileRouter = ({ userStore, requireAccessToken }) => {
  const router = Router();
  const storage = new DocumentStorageService(userStore);
  const service = new StudentProfileService(userStore, storage);
  const controller = new StudentProfileController(service, storage);
  router.use(requireAccessToken);
  router.route('/').post(controller.create).get(controller.get).patch(controller.update).put(controller.update);
  router.get('/completion', controller.completion);
  router.route('/financial').post(controller.financial).put(controller.financial).get(controller.getFinancial);
  router.post('/documents', upload.single('file'), controller.upload);
  router.get('/documents', controller.listDocuments);
  router.put('/documents/:documentId', upload.single('file'), controller.replace);
  router.delete('/documents/:documentId', controller.remove);
  router.get('/documents/:documentId/content', controller.download);
  router.post('/submit', controller.submit);
  return router;
};
