export const students = [
  { id: 1, name: 'Aarav Mehta', initials: 'AM', location: 'Mumbai, India', program: 'MSc Data Science', education: 'B.Tech Computer Science', gpa: '8.8 / 10', exam: 'IELTS 8.0', score: 96, skills: ['Python', 'Machine Learning', 'SQL'], shortlisted: false, color: '#7457dc' },
  { id: 2, name: 'Sara Khan', initials: 'SK', location: 'Lahore, Pakistan', program: 'MSc Data Science', education: 'BSc Software Engineering', gpa: '3.7 / 4', exam: 'IELTS 7.5', score: 93, skills: ['Python', 'Data Analysis', 'Tableau'], shortlisted: true, color: '#e17955' },
  { id: 3, name: 'Daniel Okafor', initials: 'DO', location: 'Lagos, Nigeria', program: 'MSc Artificial Intelligence', education: 'BSc Computer Engineering', gpa: '4.5 / 5', exam: 'TOEFL 108', score: 91, skills: ['TensorFlow', 'Research', 'C++'], shortlisted: false, color: '#16836b' },
  { id: 4, name: 'Mei Lin', initials: 'ML', location: 'Shanghai, China', program: 'MSc Data Science', education: 'BEng Information Systems', gpa: '3.6 / 4', exam: 'IELTS 7.5', score: 89, skills: ['R', 'Statistics', 'Power BI'], shortlisted: true, color: '#3979b8' },
  { id: 5, name: 'Lucas Pereira', initials: 'LP', location: 'São Paulo, Brazil', program: 'MSc Artificial Intelligence', education: 'BSc Computer Science', gpa: '8.6 / 10', exam: 'TOEFL 103', score: 87, skills: ['Java', 'NLP', 'Cloud'], shortlisted: false, color: '#bc7650' }
];

export const offers = [
  { id: 'offer-1000', student_id: 1, institution: 'Northbridge University', institution_initial: 'N', program: 'MSc Data Science', award: '40% Global Excellence Scholarship', status: 'SENT', sent_at: '2026-07-24T10:00:00.000Z' },
  { id: 'offer-1001', student_id: 2, program: 'MSc Data Science', award: '30% scholarship', status: 'VIEWED', sent_at: '2026-07-18T10:00:00.000Z' },
  { id: 'offer-1002', student_id: 4, program: 'MSc Data Science', award: '20% scholarship', status: 'ACCEPTED', sent_at: '2026-07-15T10:00:00.000Z' },
  { id: 'offer-1003', student_id: 3, program: 'MSc Artificial Intelligence', award: 'Priority admission', status: 'SENT', sent_at: '2026-07-12T10:00:00.000Z' }
];
