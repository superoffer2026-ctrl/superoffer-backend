import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const REQUIRED_DOCUMENTS: Record<string, string[]> = {
  UG: ['10th Mark Sheet', '12th Mark Sheet / Latest Marks'],
  PG: ['10th Mark Sheet', '12th Mark Sheet', 'Undergraduate Transcript / Consolidated Mark Sheet'],
  PHD: ["Bachelor's Transcript", "Master's Transcript"]
};

const PROFILE_FIELDS = ['basic', 'studyLevel', 'academic', 'preferences', 'selectedTests', 'testDetails', 'achievements', 'links'] as const;

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.studentProfile.create({ data: { userId } });
  }

  async getMyProfile(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    const documents = await this.prisma.studentDocument.findMany({ where: { userId }, orderBy: { uploadedAt: 'desc' } });
    return { ...profile, documents };
  }

  /** Merges the onboarding wizard's whole-form payload (everything except `financial`, which has its own endpoint). */
  async updateProfile(userId: string, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const data: Record<string, unknown> = {};

    for (const field of PROFILE_FIELDS) {
      if (payload[field] === undefined) continue;
      if (field === 'studyLevel') {
        data.studyLevel = payload.studyLevel || null;
      } else if (field === 'selectedTests') {
        data.selectedTests = Array.isArray(payload.selectedTests) ? payload.selectedTests : [];
      } else {
        const current = (profile[field as keyof typeof profile] as Record<string, unknown>) || {};
        data[field] = { ...current, ...(payload[field] as Record<string, unknown>) } as Prisma.InputJsonValue;
      }
    }

    return this.prisma.studentProfile.update({ where: { userId }, data });
  }

  async updateFinancial(userId: string, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile.financial as Record<string, unknown>) || {};
    const financial = { ...current, ...payload } as Prisma.InputJsonValue;
    return this.prisma.studentProfile.update({ where: { userId }, data: { financial } });
  }

  async submit(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    if (!profile) throw new NotFoundException('Student profile not found');

    return this.prisma.studentProfile.update({
      where: { userId },
      data: { status: 'SUBMITTED', submittedAt: new Date() }
    });
  }

  async offers(_userId: string) {
    return { results: [], total_results: 0 };
  }

  async completion(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    const documents = await this.prisma.studentDocument.findMany({ where: { userId }, select: { documentType: true } });
    const uploadedTypes = new Set(documents.map(document => document.documentType));

    const basic = (profile.basic as Record<string, string>) || {};
    const academic = (profile.academic as Record<string, string>) || {};
    const preferences = (profile.preferences as Record<string, any>) || {};
    const financial = (profile.financial as Record<string, any>) || {};
    const studyLevel = profile.studyLevel || '';

    const academicDone = (): boolean => {
      if (studyLevel === 'UG') return Boolean(academic.schoolName && academic.board && academic.tenthScore && academic.twelfthScore && academic.passingYear);
      if (studyLevel === 'PG') return Boolean(academic.collegeName && academic.university && academic.degree && academic.major && academic.cgpa && academic.graduationYear);
      if (studyLevel === 'PHD') return Boolean(academic.bachelors && academic.masters && academic.university && academic.specialization && academic.mastersCgpa && academic.graduationYear);
      return false;
    };

    const requiredDocs = REQUIRED_DOCUMENTS[studyLevel] || [];

    const checklist = [
      { key: 'basicInformation', label: 'Basic Information', done: Boolean(basic.firstName && basic.lastName && basic.email && basic.mobile && basic.dateOfBirth && basic.country) },
      { key: 'studyPreferences', label: 'Study Preferences', done: Boolean(preferences.course && preferences.countries?.length && preferences.intake?.length) },
      { key: 'academicInformation', label: 'Academic Information', done: academicDone() },
      { key: 'testsCompleted', label: 'Tests Completed', done: Boolean(profile.selectedTests?.length) },
      { key: 'documentsUploaded', label: 'Documents', done: requiredDocs.length > 0 && requiredDocs.every(doc => uploadedTypes.has(doc)) },
      { key: 'financialInformation', label: 'Financial Information', done: Boolean(financial.fundingPreference && financial.estimatedAnnualBudget && financial.interestedInScholarships !== null && financial.interestedInScholarships !== undefined && financial.preferLowerTuition !== null && financial.preferLowerTuition !== undefined && financial.needFinancialAssistance !== null && financial.needFinancialAssistance !== undefined) }
    ];

    const doneCount = checklist.filter(item => item.done).length;
    return {
      completionPercent: Math.round((doneCount / checklist.length) * 100),
      status: profile.status,
      sections: checklist,
      missing: checklist.filter(item => !item.done).map(item => item.label)
    };
  }
}
