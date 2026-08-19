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

const ORGANIZATION_TYPE_BY_ROLE: Record<string, OrganizationType> = {
  UNIVERSITY_OFFICER: OrganizationType.UNIVERSITY,
  LOAN_OFFICER: OrganizationType.BANK,
  CONSULTANT: OrganizationType.CONSULTANCY
};

const normalizePhone = (phone: string): string => String(phone || '').trim().replace(/[\s()-]/g, '');

type SessionMeta = { deviceInfo?: string };
type UserWithOrganization = User & { organization?: { name: string; organizationType: OrganizationType; registrationNumber: string | null; licenseReference: string | null; website: string | null; country: string | null; city: string | null; verificationStatus: string; rejectionReason: string | null; reviewedAt: Date | null } | null };

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    @Inject(WHATSAPP_SENDER) private whatsApp: WhatsAppSender
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() ? normalizePhone(dto.phone) : undefined;

    if (dto.role === 'STUDENT') {
      throw new BadRequestException({
        code: 'STUDENT_USES_OTP_LOGIN',
        message: 'Students sign in with a WhatsApp OTP — use POST /api/v1/auth/otp/request',
        otp_login_endpoint: '/api/v1/auth/otp/request'
      });
    }
    const organizationType = ORGANIZATION_TYPE_BY_ROLE[dto.role];
    if (!organizationType) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'The selected role cannot be registered' });
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
          name: dto.organization.name,
          organizationType,
          registrationNumber: dto.organization.registrationNumber,
          licenseReference: dto.organization.licenseReference,
          website: dto.organization.website,
          country: dto.organization.country,
          city: dto.organization.city
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
      can_login: user.organization?.verificationStatus === 'APPROVED'
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
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }
    if (user.role === Role.STUDENT) {
      throw new BadRequestException({
        code: 'STUDENT_USES_OTP_LOGIN',
        message: 'Students sign in with a WhatsApp OTP — use POST /api/v1/auth/otp/request',
        otp_login_endpoint: '/api/v1/auth/otp/request'
      });
    }

    const lockedUntil = user.lockedUntil?.getTime() ?? 0;
    if (lockedUntil > Date.now()) {
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
      if (shouldLock) {
        throw new HttpException(
          { code: 'ACCOUNT_LOCKED', message: 'Account is temporarily locked', retry_after_seconds: Math.ceil(LOCK_DURATION_MS / 1000) },
          423
        );
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }

    if (user.organization) {
      if (user.organization.verificationStatus === 'PENDING') {
        throw new HttpException(
          { code: 'ACCOUNT_PENDING_APPROVAL', message: 'Your organization is still being reviewed by the SuperOffer admin team', user_id: user.id, approval_status: 'PENDING' },
          403
        );
      }
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
      approval_status: user.organization?.verificationStatus || 'APPROVED',
      organization: user.organization ? { name: user.organization.name, organizationType: user.organization.organizationType } : null
    };
  }

  async status(userId: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } })) as UserWithOrganization | null;
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Registration was not found' });
    const approvalStatus = user.organization?.verificationStatus || 'APPROVED';
    return {
      user_id: user.id,
      role: user.role,
      approval_status: approvalStatus,
      can_login: approvalStatus === 'APPROVED',
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
    const payload = { sub: user.id, email: user.email ?? undefined, phone: user.phone ?? undefined, role: user.role };
    const accessTtl = Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS')) || 3600;
    const refreshTtl = Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS')) || 2_592_000;
    const accessToken = this.jwt.sign(payload, { expiresIn: accessTtl });
    const refreshToken = this.jwt.sign(payload, { expiresIn: refreshTtl });

    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        deviceInfo: meta.deviceInfo,
        expiresAt: new Date(Date.now() + refreshTtl * 1000)
      }
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
