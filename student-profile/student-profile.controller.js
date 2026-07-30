import { validateDocumentType, validateFinancial, validateProfile } from './student-profile.validation.js';

const invalid = (response, errors) => response.status(400).json({ code: 'VALIDATION_ERROR', message: errors[0], errors });

export class StudentProfileController {
  constructor(service, storage) { this.service = service; this.storage = storage; }
  userId(request) { return request.auth.sub; }

  get = async (request, response, next) => { try { response.json(await this.service.get(this.userId(request))); } catch (error) { next(error); } };
  create = async (request, response, next) => {
    try {
      const errors = validateProfile(request.body);
      if (errors.length) return invalid(response, errors);
      const profile = await this.service.create(this.userId(request), request.body);
      if (!profile) return response.status(409).json({ code: 'PROFILE_EXISTS', message: 'A student profile already exists' });
      response.status(201).json(profile);
    } catch (error) { next(error); }
  };
  update = async (request, response, next) => {
    try {
      const errors = validateProfile(request.body, { partial: true });
      if (errors.length) return invalid(response, errors);
      response.json(await this.service.update(this.userId(request), request.body));
    } catch (error) { next(error); }
  };
  completion = async (request, response, next) => { try { response.json((await this.service.get(this.userId(request))).completion); } catch (error) { next(error); } };
  financial = async (request, response, next) => {
    try {
      const errors = validateFinancial(request.body);
      if (errors.length) return invalid(response, errors);
      const profile = await this.service.financial(this.userId(request), request.body);
      response.status(request.method === 'POST' ? 201 : 200).json(profile.financial);
    } catch (error) { next(error); }
  };
  getFinancial = async (request, response, next) => { try { response.json((await this.service.get(this.userId(request))).financial || null); } catch (error) { next(error); } };
  upload = async (request, response, next) => {
    try {
      if (!request.file) return invalid(response, ['A document file is required']);
      const profile = await this.service.get(this.userId(request));
      if (!validateDocumentType(profile.studyLevel, request.body.documentType)) return invalid(response, ['documentType is not valid for the selected study level']);
      const document = await this.storage.save({ userId: this.userId(request), documentType: request.body.documentType, file: request.file });
      await this.service.syncDocuments(this.userId(request));
      response.status(201).json(document);
    } catch (error) { next(error); }
  };
  listDocuments = async (request, response, next) => { try { const documents = await this.storage.list(this.userId(request)); response.json({ documents, total: documents.length }); } catch (error) { next(error); } };
  replace = async (request, response, next) => {
    try {
      if (!request.file) return invalid(response, ['A replacement file is required']);
      const existing = await this.storage.get(this.userId(request), request.params.documentId);
      if (!existing) return response.status(404).json({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found' });
      const document = await this.storage.save({ userId: this.userId(request), documentType: existing.metadata.documentType, file: request.file, previousId: request.params.documentId });
      await this.service.syncDocuments(this.userId(request));
      response.json(document);
    } catch (error) { next(error); }
  };
  remove = async (request, response, next) => {
    try {
      const removed = await this.storage.delete(this.userId(request), request.params.documentId);
      if (!removed) return response.status(404).json({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found' });
      await this.service.syncDocuments(this.userId(request));
      response.status(204).end();
    } catch (error) { next(error); }
  };
  download = async (request, response, next) => {
    try {
      const item = await this.storage.get(this.userId(request), request.params.documentId);
      if (!item) return response.status(404).json({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found' });
      response.type(item.metadata.mimeType).set('content-disposition', `inline; filename="${item.metadata.fileName.replaceAll('"', '')}"`);
      if (item.stream) item.stream.on('error', next).pipe(response); else response.send(item.buffer);
    } catch (error) { next(error); }
  };
  submit = async (request, response, next) => {
    try {
      const result = await this.service.submit(this.userId(request));
      if (!result.submitted) return response.status(422).json({ code: 'PROFILE_INCOMPLETE', message: 'Complete all required profile sections and documents before submission', completion: result.profile.completion });
      response.json(result.profile);
    } catch (error) { next(error); }
  };
}
