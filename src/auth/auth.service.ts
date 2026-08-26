import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationType, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { OtpRequestDto, OtpVerifyDto } from './dto/otp.dto';
import { RegisterDto } from './dto/register.dto';
import { generateOtpCode, hashOtp, hashToken, verifyOtpHash } from './otp.util';
import { WHATSAPP_SENDER, WhatsAppSender } from './whatsapp-sender';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

/**
 * The two sides of the market.
 *
 * Consultancies were a third role with no economics of its own: the platform
 * exists so a university and a lender can reach a student directly, which is
 * the work an agent used to be paid for. CONSULTANCY stays in the enum so any
 * row created before this still reads back, but nothing new can be created.
 */
const ORGANIZATION_TYPE_BY_ROLE: Record<string, OrganizationType> = {
  UNIVERSITY_OFFICER: OrganizationType.UNIVERSITY,
  LOAN_OFFICER: OrganizationType.BANK
};

const normalizePhone = (phone: string): string => String(phone || '').trim().replace(/[\s()-]/g, '');

type SessionMeta = { deviceInfo?: string; ip?: string };
type UserWithOrganization = User & { organization?: { name: string; organizationType: OrganizationType; registrationNumber: string | null; licenseReference: string | null; website: string | null; country: string | null; city: string | null; verificationStatus: string; rejectionReason: string | null; reviewedAt: Date | null } | null };

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    @Inject(WHATSAPP_SENDER) private whatsApp: WhatsAppSender
  ) {}

  /** Append-only trail behind the admin panel's Auth logs. Never throws — a logging
   *  failure must not break a login. */
  private async recordLoginEvent(input: {
    email: string;
    outcome: 'SUCCESS' | 'FAILED' | 'LOCKED';
    userId?: string;
    role?: string;
    meta?: SessionMeta;
  }) {
    try {
      await this.prisma.loginEvent.create({
        data: {
          email: input.email,
          outcome: input.outcome,
          userId: input.userId,
          role: input.role,
          ip: input.meta?.ip,
          userAgent: input.meta?.deviceInfo
        }
      });
    } catch {
      /* logging is best-effort */
    }
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() ? normalizePhone(dto.phone) : undefined;

    const isStudent = dto.role === 'STUDENT';
    const organizationType = isStudent ? undefined : ORGANIZATION_TYPE_BY_ROLE[dto.role];
    if (!isStudent && !organizationType) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'The selected role cannot be registered' });
    }
    if (!isStudent && !dto.organization?.name) {
      throw new BadRequestException({ code: 'ORGANIZATION_REQUIRED', message: 'Institution accounts must include organization details' });
    }

    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email' });
    }
    if (phone && (await this.prisma.user.findUnique({ where: { phone } }))) {
      throw new ConflictException({ code: 'PHONE_ALREADY_REGISTERED', message: 'An account already exists for this phone number' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const role = dto.role as Role;

    /** Students have no organization and no approval step — they can sign in immediately. */
    if (isStudent) {
      const student = await this.prisma.$transaction(async tx => {
        const created = await tx.user.create({ data: { email, phone, passwordHash, fullName: dto.fullName, role } });
        await tx.studentProfile.create({ data: { userId: created.id } });
        return created;
      });

      return { user_id: student.id, role: student.role, approval_status: 'APPROVED', can_login: true };
    }

    const user = await this.prisma.$transaction(async tx => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organization!.name,
          organizationType: organizationType!,
          registrationNumber: dto.organization!.registrationNumber,
          licenseReference: dto.organization!.licenseReference,
          website: dto.organization!.website,
          country: dto.organization!.country,
          city: dto.organization!.city
        }
      });
      return tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          fullName: dto.fullName,
          role,
          organizationId: organization.id
        },
        include: { organization: true }
      });
    });

    return {
      user_id: user.id,
      role: user.role,
      approval_status: user.organization?.verificationStatus,
      /** Signing in is allowed while pending; what it reaches is not. */
      can_login: user.organization?.verificationStatus !== 'REJECTED'
    };
  }

  async login(dto: LoginDto, meta: SessionMeta = {}) {
    const identifier = dto.identifier.trim();
    const email = identifier.toLowerCase();
    let user = (await this.prisma.user.findUnique({ where: { email }, include: { organization: true } })) as UserWithOrganization | null;

    if (!user) {
      const phoneCandidate = normalizePhone(identifier);
      if (PHONE_PATTERN.test(phoneCandidate)) {
        user = (await this.prisma.user.findUnique({ where: { phone: phoneCandidate }, include: { organization: true } })) as UserWithOrganization | null;
      }
    }

    if (!user) {
      await this.recordLoginEvent({ email: identifier, outcome: 'FAILED', meta });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }
    const lockedUntil = user.lockedUntil?.getTime() ?? 0;
    if (lockedUntil > Date.now()) {
      await this.recordLoginEvent({ email: identifier, outcome: 'LOCKED', userId: user.id, role: user.role, meta });
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Account is temporarily locked', retry_after_seconds: Math.ceil((lockedUntil - Date.now()) / 1000) },
        423
      );
    }

    const valid = user.passwordHash ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!valid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedLoginAttempts >= MAX_FAILED_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts, lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null }
      });
      await this.recordLoginEvent({
        email: identifier,
        outcome: shouldLock ? 'LOCKED' : 'FAILED',
        userId: user.id,
        role: user.role,
        meta
      });
      if (shouldLock) {
        throw new HttpException(
          { code: 'ACCOUNT_LOCKED', message: 'Account is temporarily locked', retry_after_seconds: Math.ceil(LOCK_DURATION_MS / 1000) },
          423
        );
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }

    if (user.organization) {
      /*
       * A pending organisation signs in and works on its verification. It sees
       * its own workspace and not one student: every route that reads student
       * data sits behind ApprovedOrganizationGuard, so access is refused where
       * the data is rather than at the door. Locking them out instead left a
       * registrar with a password, no way to supply what was asked for, and
       * nothing to do but email support.
       */
      if (user.organization.verificationStatus === 'REJECTED') {
        throw new HttpException(
          { code: 'ACCOUNT_REJECTED', message: user.organization.rejectionReason || 'Your organization registration was not approved', user_id: user.id, approval_status: 'REJECTED' },
          403
        );
      }
    }

    const updated = (await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      include: { organization: true }
    })) as UserWithOrganization;

    await this.recordLoginEvent({ email: identifier, outcome: 'SUCCESS', userId: user.id, role: user.role, meta });
    return this.issueTokens(updated, meta);
  }

  async me(userId: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } })) as UserWithOrganization | null;
    if (!user) throw new UnauthorizedException();
    return {
      user_id: user.id,
      email: user.email || '',
      phone: user.phone || '',
      full_name: user.fullName || '',
      role: user.role,
      password_changed_at: user.passwordChangedAt,
      approval_status: user.organization?.verificationStatus || 'APPROVED',
      organization: user.organization ? { name: user.organization.name, organizationType: user.organization.organizationType } : null
    };
  }

  /** Name and email edits from the account settings screens. */
  async updateAccount(userId: string, dto: { fullName?: string; email?: string }) {
    const data: Record<string, unknown> = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const clash = await this.prisma.user.findUnique({ where: { email } });
      if (clash && clash.id !== userId) {
        throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email' });
      }
      data.email = email;
      data.emailVerifiedAt = null;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.me(userId);
  }

  async changePassword(userId: string, current: string, next: string, currentSessionId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Your current password is incorrect' });
    }
    if (next.length < 8) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'New password must be at least 8 characters' });
    }
    const changedAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 12), passwordChangedAt: changedAt }
    });
    /**
     * Every *other* session is invalidated, so a stolen token can't outlive the
     * change — but the device making the change stays signed in.
     */
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
      data: { revokedAt: new Date() }
    });
    return { changed: true, changedAt };
  }

  /** Revokes just this session, so the token stops working the moment they sign out. */
  async logout(sessionId?: string) {
    if (sessionId) {
      await this.prisma.authSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }
    return { signedOut: true };
  }

  async status(userId: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } })) as UserWithOrganization | null;
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Registration was not found' });
    const approvalStatus = user.organization?.verificationStatus || 'APPROVED';
    return {
      user_id: user.id,
      role: user.role,
      approval_status: approvalStatus,
      can_login: approvalStatus !== 'REJECTED',
      organization_name: user.organization?.name || null,
      rejection_reason: user.organization?.rejectionReason || null,
      submitted_at: user.createdAt,
      reviewed_at: user.organization?.reviewedAt || null
    };
  }

  async requestOtp(dto: OtpRequestDto) {
    const phone = normalizePhone(dto.phone);
    if (!PHONE_PATTERN.test(phone)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'A valid phone number is required' });
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (user && user.role !== Role.STUDENT) {
      throw new ConflictException({ code: 'PHONE_ALREADY_REGISTERED', message: 'This phone number is already registered to a non-student account' });
    }
    if (!user) {
      user = await this.prisma.$transaction(async tx => {
        const created = await tx.user.create({ data: { phone, fullName: dto.fullName?.trim() || undefined, role: Role.STUDENT } });
        await tx.studentProfile.create({ data: { userId: created.id } });
        return created;
      });
    }

    const cooldownSeconds = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS')) || 30;
    const latest = await this.prisma.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && latest.createdAt.getTime() + cooldownSeconds * 1000 > Date.now()) {
      throw new HttpException(
        {
          code: 'OTP_ALREADY_SENT',
          message: 'An OTP was already sent recently, please wait before requesting another',
          retry_after_seconds: Math.ceil((latest.createdAt.getTime() + cooldownSeconds * 1000 - Date.now()) / 1000)
        },
        429
      );
    }

    const ttlSeconds = Number(this.config.get('OTP_TTL_SECONDS')) || 300;
    const code = generateOtpCode();
    const otpSecret = this.otpSecret();

    await this.prisma.otpCode.create({
      data: { phone, codeHash: hashOtp(code, otpSecret), purpose: 'LOGIN', expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
    });

    await this.whatsApp.sendOtp(phone, code);

    return { user_id: user.id, phone, otp_sent: true, expires_in_seconds: ttlSeconds };
  }

  async verifyOtp(dto: OtpVerifyDto, meta: SessionMeta = {}) {
    const phone = normalizePhone(dto.phone);
    const code = dto.code.trim();
    if (!PHONE_PATTERN.test(phone) || !code) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'phone and code are required' });
    }

    const record = await this.prisma.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!record) {
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Request a new OTP for this phone number' });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: 'This OTP has expired, request a new one' });
    }

    const otpSecret = this.otpSecret();
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS')) || 5;

    if (!verifyOtpHash(code, record.codeHash, otpSecret)) {
      const attempts = record.attempts + 1;
      const exhausted = attempts >= maxAttempts;
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { attempts, consumedAt: exhausted ? new Date() : null } });
      if (exhausted) {
        throw new BadRequestException({ code: 'OTP_INVALID', message: 'Too many incorrect attempts, request a new OTP' });
      }
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'The OTP entered is incorrect' });
    }

    await this.prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No account found for this phone number' });
    }

    const updated = (await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      include: { organization: true }
    })) as UserWithOrganization;

    return this.issueTokens(updated, meta);
  }

  private otpSecret(): string {
    return (
      this.config.get<string>('OTP_HASH_SECRET') ||
      this.config.get<string>('AUTH_TOKEN_SECRET') ||
      'development-only-secret-change-before-deploying'
    );
  }

  private async issueTokens(user: UserWithOrganization, meta: SessionMeta) {
    const accessTtl = Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS')) || 3600;
    const refreshTtl = Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS')) || 2_592_000;

    /**
     * The session row is created first so its id can be signed into the token as
     * `sid`. Without that link the guard has no way to tell a revoked session
     * from a live one, and revoking a session would have no effect until the
     * token happened to expire.
     */
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: '',
        deviceInfo: meta.deviceInfo,
        expiresAt: new Date(Date.now() + refreshTtl * 1000)
      }
    });

    const payload = {
      sub: user.id,
      sid: session.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      role: user.role
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: accessTtl });
    const refreshToken = this.jwt.sign(payload, { expiresIn: refreshTtl });

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashToken(refreshToken) }
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: accessTtl,
      role: user.role,
      full_name: user.fullName || '',
      organization: user.organization
        ? {
            name: user.organization.name,
            organizationType: user.organization.organizationType,
            registrationNumber: user.organization.registrationNumber,
            licenseReference: user.organization.licenseReference,
            website: user.organization.website,
            country: user.organization.country,
            city: user.organization.city
          }
        : null,
      mfa_required: false,
      email_verified: Boolean(user.emailVerifiedAt),
      phone_verified: Boolean(user.phoneVerifiedAt)
    };
  }
}
