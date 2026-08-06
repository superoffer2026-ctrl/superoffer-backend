import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ProfileSection = 'personal' | 'academic' | 'studyPreferences' | 'entranceExams' | 'financial' | 'projects';

const SECTIONS: ProfileSection[] = ['personal', 'academic', 'studyPreferences', 'entranceExams', 'financial', 'projects'];

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.studentProfile.create({ data: { userId } });
  }

  async getMyProfile(userId: string) {
    return this.getOrCreateProfile(userId);
  }

  async updateSection(userId: string, section: ProfileSection, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile[section] as Record<string, unknown>) || {};
    const merged = { ...current, ...payload };

    return this.prisma.studentProfile.update({
      where: { userId },
      data: { [section]: merged }
    });
  }

  async submit(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    if (!profile) throw new NotFoundException('Student profile not found');

    return this.prisma.studentProfile.update({
      where: { userId },
      data: { status: 'SUBMITTED', submittedAt: new Date() }
    });
  }

  async completion(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    const personal = (profile.personal as Record<string, string>) || {};
    const academic = (profile.academic as Record<string, string>) || {};
    const study = (profile.studyPreferences as Record<string, any>) || {};
    const exams = (profile.entranceExams as Record<string, any[]>) || {};
    const financial = (profile.financial as Record<string, any>) || {};

    const checklist = [
      { key: 'personalInformation', label: 'Personal Information', done: !!(personal.fullName && personal.email && personal.mobileNumber && personal.country && personal.city) },
      { key: 'studyPreferences', label: 'Study Preferences', done: !!(study.countries && study.fieldOfInterest && study.studyLevel && study.startYear && study.intake) },
      { key: 'academicInformation', label: 'Academic Information', done: !!(academic.qualificationLevel && academic.institution && academic.score && academic.graduationYear) },
      { key: 'englishTest', label: 'English Language Test', done: Array.isArray(exams.englishExams) && exams.englishExams.length > 0 },
      { key: 'standardizedTest', label: 'Standardized Test', done: Array.isArray(exams.competitiveExams) && exams.competitiveExams.length > 0 },
      { key: 'financialInformation', label: 'Financial Information', done: !!(financial.fundingSource && financial.earningMembers && financial.currency && financial.employmentCategory) }
    ];

    const doneCount = checklist.filter(item => item.done).length;
    return {
      completionPercent: Math.round((doneCount / checklist.length) * 100),
      status: profile.status,
      sections: checklist,
      missing: checklist.filter(item => !item.done).map(item => item.label)
    };
  }

  static get sections() {
    return SECTIONS;
  }
}
