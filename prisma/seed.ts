/**
 * Development seed data.
 *
 *   npm run prisma:seed
 *
 * Idempotent — safe to re-run. Creates two approved organizations with officers,
 * two students (one with a submitted, discoverable profile), and one live offer
 * so every workspace has something to show.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * The password every seeded account gets.
 *
 * Development keeps a memorable default. Anywhere real, SEED_PASSWORD must be
 * supplied — this file is public, so a password written here is a published
 * credential for whatever it is run against.
 */
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

if (!process.env.SEED_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error(
    'Refusing to seed production with the public default password. ' +
    'Run again with SEED_PASSWORD set to something only you know.'
  );
  process.exit(1);
}

async function seedOrganization(input: {
  name: string;
  type: 'UNIVERSITY' | 'BANK';
  registrationNumber: string;
  country: string;
  city: string;
  officerEmail: string;
  officerName: string;
  officerRole: 'UNIVERSITY_OFFICER' | 'LOAN_OFFICER';
}) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const existing = await prisma.user.findUnique({ where: { email: input.officerEmail }, include: { organization: true } });
  if (existing?.organization) {
    /** Re-seeding refreshes the credential, so the password printed below is the one that works. */
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
    return existing.organization;
  }

  const organization = await prisma.organization.create({
    data: {
      name: input.name,
      organizationType: input.type,
      registrationNumber: input.registrationNumber,
      country: input.country,
      city: input.city,
      /** Seeded organizations skip the approval queue so you can log straight in. */
      verificationStatus: 'APPROVED',
      reviewedAt: new Date(),
      reviewNote: 'Approved by seed script'
    }
  });

  await prisma.user.create({
    data: {
      email: input.officerEmail,
      passwordHash,
      fullName: input.officerName,
      role: input.officerRole,
      organizationId: organization.id,
      emailVerifiedAt: new Date()
    }
  });

  return organization;
}

/** Students hold no email: the WhatsApp number is the account. `phoneVerifiedAt`
 *  is stamped so a seeded student can sign in without walking the OTP step. */
async function seedStudent(input: { contactEmail: string; phone: string; fullName: string; submitted: boolean }) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const existing = await prisma.user.findUnique({ where: { phone: input.phone }, include: { studentProfile: true } });
  if (existing) {
    /** Re-running after the switch to WhatsApp identity clears any address left on older rows. */
    return prisma.user.update({
      where: { id: existing.id },
      data: { email: null, emailVerifiedAt: null, passwordHash, phoneVerifiedAt: new Date() },
      include: { studentProfile: true }
    });
  }

  return prisma.user.create({
    data: {
      passwordHash,
      phone: input.phone,
      fullName: input.fullName,
      role: 'STUDENT',
      phoneVerifiedAt: new Date(),
      studentProfile: {
        create: input.submitted
          ? {
              status: 'SUBMITTED',
              submittedAt: new Date(),
              personal: {
                fullName: input.fullName,
                /** A contact detail on the profile that organisations use — not a sign-in credential. */
                email: input.contactEmail,
                mobileCountry: 'IN',
                mobileNumber: input.phone.replace('+91', ''),
                country: 'India',
                city: 'Bengaluru',
                phone: input.phone,
                location: 'Bengaluru, India'
              },
              studyPreferences: {
                countries: ['Canada', 'UK'],
                studyLevel: ['Data Science'],
                fieldOfInterest: ['Artificial Intelligence'],
                startYear: ['2027'],
                intake: ['Fall']
              },
              academic: {
                qualificationLevel: "Bachelor's Degree",
                institution: 'Anna University',
                score: '8.7',
                graduationYear: '2025',
                qualification: 'B.Tech Computer Science',
                history: [
                  { level: '12th', curriculum: 'CBSE', cgpa: '9.2', startedYear: '2019', completionYear: '2021' },
                  {
                    level: "Bachelor's Degree", degreeName: 'B.Tech', specialization: 'Computer Science',
                    institutionName: 'Anna University', cgpa: '8.7', backlogs: '0',
                    startedYear: '2021', completionYear: '2025', yearsOfEducation: '16'
                  }
                ]
              },
              entranceExams: {
                englishExams: [{ exam: 'IELTS', status: 'I have the score', score: '7.5' }],
                englishExam: 'IELTS',
                englishScore: '7.5',
                competitiveExams: [{ exam: 'GRE', status: 'I have the score', score: '323' }],
                entranceExam: 'GRE',
                entranceScore: '323'
              },
              workExperience: {
                workStatus: 'Yes', relevantYears: '2', nonRelevantYears: '0',
                experiences: [{ companyName: 'Acme Corp', role: 'Data Engineer', type: 'Full-time', durationMonths: '24' }],
                companyName: 'Acme Corp', jobRole: 'Data Engineer'
              },
              financial: {
                fundingSource: 'Scholarship',
                earningMembers: ['Father', 'Mother'],
                fatherIncome: '1000000',
                motherIncome: '800000',
                annualHouseholdIncome: '1800000',
                currency: 'INR',
                needsLoan: 'yes'
              },
              projects: {
                projects: [{ title: 'Student success prediction model', role: 'Developer', description: 'ML model predicting student outcomes.' }],
                achievements: ['Hackathon Winner', 'Coding'],
                links: ['https://github.com/aarav', 'https://linkedin.com/in/aarav'],
                githubLink: 'https://github.com/aarav',
                linkedinLink: 'https://linkedin.com/in/aarav',
                projectTitle: 'Student success prediction model',
                projectRole: 'Developer'
              }
            }
          : {}
      }
    },
    include: { studentProfile: true }
  });
}

async function main() {
  const university = await seedOrganization({
    name: 'Northbridge University',
    type: 'UNIVERSITY',
    registrationNumber: 'CA-UNI-1984',
    country: 'Canada',
    city: 'Toronto',
    officerEmail: 'officer@northbridge.edu',
    officerName: 'Maya Chen',
    officerRole: 'UNIVERSITY_OFFICER'
  });

  await seedOrganization({
    name: 'EduFund Finance',
    type: 'BANK',
    registrationNumber: 'IN-NBFC-2291',
    country: 'India',
    city: 'Mumbai',
    officerEmail: 'officer@edufund.example',
    officerName: 'Rohan Kapoor',
    officerRole: 'LOAN_OFFICER'
  });

  const student = await seedStudent({ contactEmail: 'aarav@example.com', phone: '+919876543210', fullName: 'Aarav Mehta', submitted: true });
  await seedStudent({ contactEmail: 'student@example.com', phone: '+919876500000', fullName: 'New Student', submitted: false });

  /** One live offer so the student wallet and the organization pipeline aren't empty. */
  /**
   * The demo offer is replaced rather than skipped, so re-seeding restores a
   * known state even after a run has accepted, rejected or negotiated it.
   */
  const previousOffers = await prisma.offer.findMany({
    where: { studentUserId: student.id, organizationId: university.id },
    select: { id: true }
  });
  if (previousOffers.length) {
    const ids = previousOffers.map(offer => offer.id);
    await prisma.offerMessage.deleteMany({ where: { offerId: { in: ids } } });
    await prisma.offer.deleteMany({ where: { id: { in: ids } } });
  }

  {
    await prisma.offer.create({
      data: {
        organizationId: university.id,
        studentUserId: student.id,
        category: 'UNIVERSITY',
        program: 'MSc Data Science',
        headline: '40% Global Excellence Scholarship',
        valueLabel: 'Scholarship',
        value: '40% tuition',
        location: 'Toronto, Canada',
        intake: 'Fall 2027',
        conditions: 'Admission and scholarship are conditional on final transcript verification.',
        nextSteps: ['Review the scholarship conditions', 'Upload your final academic transcript', 'Confirm before the deadline'],
        contactName: 'Maya Chen',
        contactRole: 'International Admissions Adviser',
        terms: { tuitionFee: 'CAD 42,000 / year', scholarshipPct: 40, durationYears: 2 },
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        messages: {
          create: [
            {
              sender: 'institution',
              authorName: 'Maya Chen',
              body: 'Hi! We were impressed by your academic profile and would like to offer you admission with our Global Excellence Scholarship.'
            }
          ]
        }
      }
    });
  }

  console.log(`
Seed complete.

  University officer   officer@northbridge.edu     / ${PASSWORD}
  Loan officer         officer@edufund.example     / ${PASSWORD}
  Student (submitted)  +919876543210               / ${PASSWORD}
  Student (fresh)      +919876500000               / ${PASSWORD}
  Admin key            value of ADMIN_APPROVAL_KEY in .env
`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
