import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { StudentProfileController } from '../controllers/student-profile.controller.js';
import { StudentProfileService } from '../services/student-profile.service.js';

const uploadDirectory = path.resolve(process.env.STUDENT_UPLOAD_DIR || 'uploads/student-documents');
fs.mkdirSync(uploadDirectory, { recursive:true });
const storage = multer.diskStorage({
  destination:(_request,_file,done) => done(null,uploadDirectory),
  filename:(_request,file,done) => done(null,`${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const allowedMimeTypes = new Set(['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const upload = multer({ storage, limits:{ fileSize:10*1024*1024 }, fileFilter:(_request,file,done) => allowedMimeTypes.has(file.mimetype) ? done(null,true) : done(Object.assign(new Error('Only PDF, JPG, PNG, DOC, and DOCX files are allowed'),{status:415,code:'DOCUMENT_TYPE_UNSUPPORTED'})) });

export const createStudentProfileRouter = ({ userStore, requireAccessToken }) => {
  const router = express.Router();
  const controller = new StudentProfileController(new StudentProfileService(userStore));
  router.use(requireAccessToken);
  router.use(async (request,response,next) => {
    try {
      const user = await userStore.findById(request.auth.sub);
      if (!user || user.role !== 'STUDENT') return response.status(403).json({ success:false, code:'STUDENT_ACCESS_REQUIRED', message:'A student account is required' });
      request.studentUser = user; next();
    } catch(error){ next(error); }
  });
  router.get('/',controller.get);
  router.get('/completion',controller.completion);
  router.put('/personal',controller.save('personal'));
  router.put('/education',controller.save('education'));
  router.put('/preferences',controller.save('preferences'));
  router.put('/exams',controller.save('exams'));
  router.put('/skills',controller.save('skills'));
  router.post('/documents',upload.single('file'),controller.document);
  return router;
};
