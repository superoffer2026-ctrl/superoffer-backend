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
import { OtpPurpose, OtpRequestDto, OtpVerifyDto, PasswordResetDto } from './dto/otp.dto';
import { RegisterDto } from './dto/register.dto';
import { generateOtpCode, hashOtp, hashToken, verifyOtpHash } from './otp.util';
import { normalizePhone, normalizeStudentPhone, PHONE_PATTERN } from './phone.util';
import { PASSWORD_MAX_LENGTH, PASSWORD_PATTERN, PASSWORD_REQUIREMENTS_MESSAGE } from './password.util';
import { WHATSAPP_SENDER, WhatsAppSender } from './whatsapp-sender';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** Long enough to choose and confirm a new password, short enough that a leaked one is worthless. */
const PASSWORD_RESET_TTL_SECONDS = 600;
const PASSWORD_RESET_SCOPE = 'PASSWORD_RESET';

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
   *  failure must not break a login. The `email` column holds whatever identifier
   *  was typed, which for a student is their WhatsApp number. */
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
    if (dto.role === 'STUDENT') return this.registerStudent(dto);

    const email = String(dto.email).trim().toLowerCase();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;

    const organizationType = ORGANIZATION_TYPE_BY_ROLE[dto.role];
    if (!organizationType) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'The selected role cannot be registered' });
    }
    if (!dto.organization?.name) {
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

  /**
   * A student is their WhatsApp number — there is no email anywhere in this path.
   *
   * The row is written before the number is proven, because the OTP has to be
   * addressed to *something*, but `phoneVerifiedAt` stays null and `login()`
   * refuses an unverified student. So an account exists only in the sense that
   * it cannot yet be used, and confirming the code in `verifyOtp` is what
   * actually finishes registration.
   */
  private async registerStudent(dto: RegisterDto) {
    const phone = normalizeStudentPhone(dto.phone);
    const fullName = dto.fullName?.trim();
    if (!phone) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Enter the 10-digit WhatsApp number that follows +91'
      });
    }
    if (!fullName) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Enter your full name' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const existing = await this.prisma.user.findUnique({ where: { phone } });

    /**
     * An abandoned signup — the row is there, the code never came back — is not
     * an account anybody owns, so the number is handed to whoever proves it
     * next rather than being stranded forever. Overwriting the pending password
     * is safe precisely because nothing can be done with it until an OTP
     * delivered to that number is entered.
     */
    if (existing) {
      if (existing.role !== Role.STUDENT || existing.phoneVerifiedAt) {
        throw new ConflictException({
          code: 'PHONE_ALREADY_REGISTERED',
          message: 'An account already exists for this WhatsApp number'
        });
      }
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { fullName, passwordHash, failedLoginAttempts: 0, lockedUntil: null }
      });
      return { user_id: existing.id, role: Role.STUDENT, phone, otp_required: true, can_login: false, ...(await this.sendOtp(phone, 'REGISTER')) };
    }

    const student = await this.prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { phone, passwordHash, fullName, role: Role.STUDENT } });
      await tx.studentProfile.create({ data: { userId: created.id } });
      return created;
    });

    return { user_id: student.id, role: student.role, phone, otp_required: true, can_login: false, ...(await this.sendOtp(phone, 'REGISTER')) };
  }

  async login(dto: LoginDto, meta: SessionMeta = {}) {
    const identifier = dto.identifier.trim();

    /**
     * One field, two kinds of account. A student types the ten digits behind
     * +91 and has no email at all; an institution types the email it registered
     * with, or its own international number. Phone lookups go first because they
     * are the only ones a student can match.
     */
    const generalPhone = normalizePhone(identifier);
    const candidates = [
      normalizeStudentPhone(identifier),
      PHONE_PATTERN.test(generalPhone) ? generalPhone : ''
    ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

    let user: UserWithOrganization | null = null;
    for (const candidate of candidates) {
      user = (await this.prisma.user.findUnique({
        where: { phone: candidate },
        include: { organization: true }
      })) as UserWithOrganization | null;
      if (user) break;
    }

    if (!user && identifier.includes('@')) {
      user = (await this.prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
        include: { organization: true }
      })) as UserWithOrganization | null;
    }

    if (!user) {
      await this.recordLoginEvent({ email: identifier, outcome: 'FAILED', meta });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Those sign-in details are incorrect' });
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
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Those sign-in details are incorrect' });
    }

    /**
     * The password was right, but the number behind it was never proven. Sending
     * them back to the OTP step — rather than refusing outright — is what makes
     * an interrupted signup resumable instead of a dead end.
     */
    if (user.role === Role.STUDENT && !user.phoneVerifiedAt) {
      throw new HttpException(
        {
          code: 'PHONE_NOT_VERIFIED',
          message: 'Confirm your WhatsApp number to finish creating your account',
          phone: user.phone
        },
        403
      );
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
    const account = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!account) throw new UnauthorizedException();

    const data: Record<string, unknown> = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.email !== undefined) {
      if (account.role === Role.STUDENT) {
        throw new BadRequestException({
          code: 'EMAIL_NOT_SUPPORTED',
          message: 'Student accounts are identified by their WhatsApp number and hold no email address'
        });
      }
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
    if (next.length > PASSWORD_MAX_LENGTH || !PASSWORD_PATTERN.test(next)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: PASSWORD_REQUIREMENTS_MESSAGE });
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

  /**
   * Sends a code to a number that already belongs to a student account.
   *
   * This deliberately does not create accounts. It used to, which meant anyone
   * who typed a number into the OTP box got a half-built account with no name
   * and no password; registration is now the only thing that creates a student.
   */
  async requestOtp(dto: OtpRequestDto) {
    const phone = normalizeStudentPhone(dto.phone);
    if (!phone) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Enter the 10-digit WhatsApp number that follows +91'
      });
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || user.role !== Role.STUDENT) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No student account is registered for this WhatsApp number'
      });
    }

    const purpose = dto.purpose || 'PASSWORD_RESET';
    return { user_id: user.id, phone, ...(await this.sendOtp(phone, purpose)) };
  }

  /**
   * Confirms a code, and hands back whatever that code was for.
   *
   * A `REGISTER` code finishes signup and signs the student in. A
   * `PASSWORD_RESET` code deliberately does not: it returns a short-lived,
   * single-purpose token that unlocks `resetPassword` and nothing else, so
   * forgetting a password never becomes a way to skip having one.
   */
  async verifyOtp(dto: OtpVerifyDto, meta: SessionMeta = {}) {
    const phone = normalizeStudentPhone(dto.phone);
    const code = dto.code.trim();
    if (!phone || !code) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'phone and code are required' });
    }

    const record = await this.prisma.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!record) {
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Request a new code for this WhatsApp number' });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: 'This code has expired, request a new one' });
    }

    const otpSecret = this.otpSecret();
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS')) || 5;

    if (!verifyOtpHash(code, record.codeHash, otpSecret)) {
      const attempts = record.attempts + 1;
      const exhausted = attempts >= maxAttempts;
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { attempts, consumedAt: exhausted ? new Date() : null } });
      if (exhausted) {
        throw new BadRequestException({ code: 'OTP_INVALID', message: 'Too many incorrect attempts, request a new code' });
      }
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'The code entered is incorrect' });
    }

    await this.prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No account found for this WhatsApp number' });
    }

    if (record.purpose === 'PASSWORD_RESET') {
      return {
        verified: true,
        purpose: 'PASSWORD_RESET',
        /** Carries no `sid`, so JwtStrategy rejects it as a session token. */
        reset_token: this.jwt.sign(
          { sub: user.id, phone, scope: PASSWORD_RESET_SCOPE },
          { expiresIn: PASSWORD_RESET_TTL_SECONDS }
        ),
        expires_in_seconds: PASSWORD_RESET_TTL_SECONDS
      };
    }

    const updated = (await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      include: { organization: true }
    })) as UserWithOrganization;

    await this.recordLoginEvent({ email: phone, outcome: 'SUCCESS', userId: user.id, role: user.role, meta });
    return this.issueTokens(updated, meta);
  }

  /**
   * The end of the forgotten-password flow. It sets the new password and stops
   * there: the student signs in again with the number and password like any
   * other day, so there is one sign-in path to reason about rather than two.
   */
  async resetPassword(dto: PasswordResetDto) {
    let claims: { sub?: string; scope?: string };
    try {
      claims = this.jwt.verify(dto.resetToken);
    } catch {
      throw new UnauthorizedException({
        code: 'RESET_TOKEN_INVALID',
        message: 'This reset link has expired, request a new code'
      });
    }
    if (claims.scope !== PASSWORD_RESET_SCOPE || !claims.sub) {
      throw new UnauthorizedException({ code: 'RESET_TOKEN_INVALID', message: 'This reset token cannot be used' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No account found' });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(dto.password, 12),
        passwordChangedAt: new Date(),
        /** Reaching a code sent to the number proves the number. */
        phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    /** Whoever was signed in before is signed out — a reset exists to lock someone out. */
    await this.prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return { reset: true };
  }

  /** Issues a code, enforcing the resend cooldown, and hands it to the WhatsApp provider. */
  private async sendOtp(phone: string, purpose: OtpPurpose) {
    const cooldownSeconds = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS')) || 30;
    const latest = await this.prisma.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && latest.createdAt.getTime() + cooldownSeconds * 1000 > Date.now()) {
      throw new HttpException(
        {
          code: 'OTP_ALREADY_SENT',
          message: 'A code was already sent recently, please wait before requesting another',
          retry_after_seconds: Math.ceil((latest.createdAt.getTime() + cooldownSeconds * 1000 - Date.now()) / 1000)
        },
        429
      );
    }

    const ttlSeconds = Number(this.config.get('OTP_TTL_SECONDS')) || 300;
    const code = generateOtpCode();

    await this.prisma.otpCode.create({
      data: { phone, codeHash: hashOtp(code, this.otpSecret()), purpose, expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
    });

    await this.whatsApp.sendOtp(phone, code);

    return { otp_sent: true, purpose, expires_in_seconds: ttlSeconds };
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
