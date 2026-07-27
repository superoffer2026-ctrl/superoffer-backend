export const studentProfile = {
  id: 1,
  name: 'Aarav Mehta',
  initials: 'AM',
  email: 'aarav.mehta@email.com',
  location: 'Mumbai, India',
  program: 'MSc Data Science',
  education: 'B.Tech Computer Science',
  gpa: '8.8 / 10',
  exam: 'IELTS 8.0',
  score: 96,
  skills: ['Python', 'Machine Learning', 'SQL'],
  completion_percent: 82,
  preferences: {
    target_countries: ['Canada', 'United Kingdom'],
    target_courses: ['Data Science', 'Artificial Intelligence'],
    degree_level: 'Masters',
    intake_term: 'Fall 2027',
    budget_band: '25,000–35,000 USD',
    scholarship_need: true
  },
  source: 'superoffer-api'
};

export const studentOffers = [
  {
    id: 'offer-1000',
    student_id: 1,
    institution: 'Northbridge University',
    institution_initial: 'N',
    program: 'MSc Data Science',
    award: '40% Global Excellence Scholarship',
    status: 'SENT',
    status_label: 'Pending',
    sent_at: '2026-07-24T10:00:00.000Z'
  }
];
