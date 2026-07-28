const database = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE || 'superoffer');

database.createCollection('students', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'name', 'location', 'program', 'score', 'skills', 'shortlisted'],
      properties: {
        id: { bsonType: 'int' },
        name: { bsonType: 'string' },
        location: { bsonType: 'string' },
        program: { bsonType: 'string' },
        score: { bsonType: 'int', minimum: 0, maximum: 100 },
        skills: { bsonType: 'array', items: { bsonType: 'string' } },
        shortlisted: { bsonType: 'bool' }
      }
    }
  }
});

database.createCollection('admission_offers', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'student_id', 'program', 'offer_type', 'status', 'sent_at'],
      properties: {
        id: { bsonType: 'string' },
        student_id: { bsonType: 'int' },
        status: { enum: ['SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'] },
        sent_at: { bsonType: 'date' }
      }
    }
  }
});

database.createCollection('student_profiles');

database.students.createIndex({ id: 1 }, { unique: true });
database.students.createIndex({ score: -1 });
database.students.createIndex({ shortlisted: 1 });
database.admission_offers.createIndex({ id: 1 }, { unique: true });
database.admission_offers.createIndex({ student_id: 1 });
database.admission_offers.createIndex({ status: 1 });
database.student_profiles.createIndex({ userId: 1 }, { unique: true });

database.students.insertMany([
  { id: NumberInt(1), name: 'Aarav Mehta', initials: 'AM', location: 'Mumbai, India', program: 'MSc Data Science', education: 'B.Tech Computer Science', gpa: '8.8 / 10', exam: 'IELTS 8.0', score: NumberInt(96), skills: ['Python', 'Machine Learning', 'SQL'], shortlisted: false, color: '#7457dc', created_at: new Date(), updated_at: new Date() },
  { id: NumberInt(2), name: 'Sara Khan', initials: 'SK', location: 'Lahore, Pakistan', program: 'MSc Data Science', education: 'BSc Software Engineering', gpa: '3.7 / 4', exam: 'IELTS 7.5', score: NumberInt(93), skills: ['Python', 'Data Analysis', 'Tableau'], shortlisted: true, color: '#e17955', created_at: new Date(), updated_at: new Date() },
  { id: NumberInt(3), name: 'Daniel Okafor', initials: 'DO', location: 'Lagos, Nigeria', program: 'MSc Artificial Intelligence', education: 'BSc Computer Engineering', gpa: '4.5 / 5', exam: 'TOEFL 108', score: NumberInt(91), skills: ['TensorFlow', 'Research', 'C++'], shortlisted: false, color: '#16836b', created_at: new Date(), updated_at: new Date() },
  { id: NumberInt(4), name: 'Mei Lin', initials: 'ML', location: 'Shanghai, China', program: 'MSc Data Science', education: 'BEng Information Systems', gpa: '3.6 / 4', exam: 'IELTS 7.5', score: NumberInt(89), skills: ['R', 'Statistics', 'Power BI'], shortlisted: true, color: '#3979b8', created_at: new Date(), updated_at: new Date() },
  { id: NumberInt(5), name: 'Lucas Pereira', initials: 'LP', location: 'São Paulo, Brazil', program: 'MSc Artificial Intelligence', education: 'BSc Computer Science', gpa: '8.6 / 10', exam: 'TOEFL 103', score: NumberInt(87), skills: ['Java', 'NLP', 'Cloud'], shortlisted: false, color: '#bc7650', created_at: new Date(), updated_at: new Date() }
]);

database.admission_offers.insertMany([
  { id: 'offer-1000', student_id: NumberInt(1), institution: 'Northbridge University', institution_initial: 'N', program: 'MSc Data Science', offer_type: 'CONDITIONAL_ADMISSION', award: '40% Global Excellence Scholarship', response_deadline: new Date('2026-08-15'), status: 'SENT', sent_at: new Date('2026-07-24T10:00:00Z'), updated_at: new Date() },
  { id: 'offer-1001', student_id: NumberInt(2), program: 'MSc Data Science', offer_type: 'CONDITIONAL_ADMISSION', award: '30% scholarship', response_deadline: new Date('2026-08-15'), status: 'VIEWED', sent_at: new Date('2026-07-18T10:00:00Z'), updated_at: new Date() },
  { id: 'offer-1002', student_id: NumberInt(4), program: 'MSc Data Science', offer_type: 'CONDITIONAL_ADMISSION', award: '20% scholarship', response_deadline: new Date('2026-08-15'), status: 'ACCEPTED', sent_at: new Date('2026-07-15T10:00:00Z'), updated_at: new Date() },
  { id: 'offer-1003', student_id: NumberInt(3), program: 'MSc Artificial Intelligence', offer_type: 'PRIORITY_ADMISSION', award: 'Priority admission', response_deadline: new Date('2026-08-15'), status: 'SENT', sent_at: new Date('2026-07-12T10:00:00Z'), updated_at: new Date() }
]);
