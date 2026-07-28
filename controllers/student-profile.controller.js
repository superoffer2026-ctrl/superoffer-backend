export class StudentProfileController {
  constructor(service) { this.service = service; }
  get = async (request,response,next) => { try { response.json({ success:true, data:await this.service.get(request.studentUser) }); } catch(error){ next(error); } };
  completion = async (request,response,next) => { try { const profile=await this.service.get(request.studentUser); response.json({ success:true, data:{ profileCompletionPercentage:profile.profileCompletionPercentage, profileComplete:profile.profileComplete, sections:profile.sections } }); } catch(error){ next(error); } };
  save = section => async (request,response,next) => { try { response.json({ success:true, message:`${section} profile saved`, data:await this.service.save(request.studentUser,section,request.body) }); } catch(error){ next(error); } };
  document = async (request,response,next) => { try { response.status(201).json({ success:true, message:'Document uploaded', data:await this.service.addDocument(request.studentUser,request.body,request.file) }); } catch(error){ next(error); } };
}
