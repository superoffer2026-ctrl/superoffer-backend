const PHONE = /^\+?[1-9]\d{7,14}$/;
const URL = /^https?:\/\/[^\s]+$/i;
const EXAMS = new Set(['IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'SAT', 'GRE', 'GMAT']);
const EXAM_RANGES = { IELTS:[0,9], TOEFL:[0,120], PTE:[0,90], DUOLINGO:[10,160], SAT:[400,1600], GRE:[260,340], GMAT:[200,800] };

const text = (value, name, { required = true, max = 500 } = {}) => {
  const result = String(value ?? '').trim();
  if (required && !result) throw validation(`${name} is required`);
  if (result.length > max) throw validation(`${name} must be ${max} characters or fewer`);
  return result;
};
const validation = message => Object.assign(new Error(message), { status: 400, code: 'PROFILE_VALIDATION_ERROR' });
const list = (value, name, required = true) => {
  if (!Array.isArray(value) || (required && !value.length)) throw validation(`${name} must be a non-empty array`);
  return [...new Set(value.map(item => text(item, name, { max: 120 })).filter(Boolean))];
};
const validDate = (value, name) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw validation(`${name} must be a valid date`);
  if (date > new Date()) throw validation(`${name} cannot be in the future`);
  return String(value);
};
const optionalUrl = (value, name) => {
  const result = text(value, name, { required: false, max: 500 });
  if (result && !URL.test(result)) throw validation(`${name} must be a valid http(s) URL`);
  return result;
};

export const validatePersonal = body => {
  const phoneNumber = text(body.phoneNumber, 'Phone number', { max: 20 });
  if (!PHONE.test(phoneNumber.replace(/[\s()-]/g, ''))) throw validation('Phone number format is invalid');
  const passportStatus = text(body.passportStatus, 'Passport status', { max: 40 });
  return {
    firstName:text(body.firstName,'First name',{max:80}), lastName:text(body.lastName,'Last name',{max:80}),
    profilePhoto:text(body.profilePhoto,'Profile photo',{required:false,max:500}), dateOfBirth:validDate(body.dateOfBirth,'Date of birth'),
    gender:text(body.gender,'Gender',{max:40}), nationality:text(body.nationality,'Nationality',{max:80}),
    country:text(body.country,'Country',{max:80}), state:text(body.state,'State',{max:100}), city:text(body.city,'City',{max:100}),
    address:text(body.address,'Address',{max:300}), phoneNumber, passportStatus,
    passportNumber:text(body.passportNumber,'Passport number',{required:false,max:40}), shortBio:text(body.shortBio,'Short bio',{max:800})
  };
};

export const validateEducation = body => {
  const studentType = text(body.studentType, 'Student type');
  if (!['SCHOOL','COLLEGE'].includes(studentType)) throw validation('Student type must be SCHOOL or COLLEGE');
  const graduationYear = Number(body.graduationYear);
  if (!Number.isInteger(graduationYear) || graduationYear < 1990 || graduationYear > 2040) throw validation('Graduation year is invalid');
  if (studentType === 'SCHOOL') return { studentType, school:{
    schoolName:text(body.school?.schoolName,'School name'), educationBoard:text(body.school?.educationBoard,'Education board'),
    currentGrade:text(body.school?.currentGrade,'Current grade'), marks10:text(body.school?.marks10,'10th marks'),
    marks11:text(body.school?.marks11,'11th marks',{required:false}), marks12:text(body.school?.marks12,'12th marks / predicted marks',{required:false}),
    graduationYear, subjects:list(body.school?.subjects,'Subjects'), academicAchievements:list(body.school?.academicAchievements||[],'Academic achievements',false)
  }};
  const cgpa = Number(body.college?.cgpa);
  const backlogs = Number(body.college?.numberOfBacklogs);
  if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) throw validation('CGPA must be between 0 and 10');
  if (!Number.isInteger(backlogs) || backlogs < 0) throw validation('Number of backlogs must be zero or greater');
  return { studentType, college:{
    collegeName:text(body.college?.collegeName,'College name'), university:text(body.college?.university,'University'),
    degree:text(body.college?.degree,'Degree'), department:text(body.college?.department,'Department'), cgpa,
    currentSemester:text(body.college?.currentSemester,'Current semester'), numberOfBacklogs:backlogs, graduationYear,
    projects:list(body.college?.projects||[],'Projects',false), internships:list(body.college?.internships||[],'Internships',false),
    academicAchievements:list(body.college?.academicAchievements||[],'Academic achievements',false)
  }};
};

export const validatePreferences = body => ({
  preferredCountries:list(body.preferredCountries,'Preferred countries'), preferredCourses:list(body.preferredCourses,'Preferred courses'),
  degreeType:text(body.degreeType,'Degree type'), preferredIntake:text(body.preferredIntake,'Preferred intake'),
  budgetRange:text(body.budgetRange,'Budget range'), scholarshipRequired:Boolean(body.scholarshipRequired),
  accommodationRequired:Boolean(body.accommodationRequired)
});

export const validateExams = body => {
  if (!Array.isArray(body.exams) || !body.exams.length) throw validation('At least one exam entry is required');
  return { exams:body.exams.map(item => {
    const examType = text(item.examType,'Exam type').toUpperCase();
    if (!EXAMS.has(examType)) throw validation(`${examType} is not a supported exam`);
    const examTaken = Boolean(item.examTaken);
    if (!examTaken) return { examType, examTaken:false, score:null, examDate:null };
    const score = Number(item.score), [min,max] = EXAM_RANGES[examType];
    if (!Number.isFinite(score) || score < min || score > max) throw validation(`${examType} score must be between ${min} and ${max}`);
    return { examType, examTaken:true, score, examDate:validDate(item.examDate,`${examType} exam date`) };
  })};
};

export const validateSkills = body => ({
  technicalSkills:list(body.technicalSkills,'Technical skills'), softSkills:list(body.softSkills,'Soft skills'),
  languagesKnown:list(body.languagesKnown,'Languages known'), certifications:list(body.certifications||[],'Certifications',false),
  hackathons:list(body.hackathons||[],'Hackathons',false), competitions:list(body.competitions||[],'Competitions',false),
  volunteerExperience:list(body.volunteerExperience||[],'Volunteer experience',false),
  leadershipExperience:list(body.leadershipExperience||[],'Leadership experience',false),
  portfolioUrl:optionalUrl(body.portfolioUrl,'Portfolio URL'), linkedInUrl:optionalUrl(body.linkedInUrl,'LinkedIn URL'),
  githubUrl:optionalUrl(body.githubUrl,'GitHub URL')
});

export const allowedDocumentTypes = new Set(['PASSPORT','RESUME','ACADEMIC_TRANSCRIPT','STATEMENT_OF_PURPOSE','RECOMMENDATION_LETTER','ENGLISH_TEST_CERTIFICATE','CERTIFICATE','OTHER']);
export const validateDocumentType = value => {
  const type = text(value,'Document type').toUpperCase();
  if (!allowedDocumentTypes.has(type)) throw validation('Unsupported document type');
  return type;
};
