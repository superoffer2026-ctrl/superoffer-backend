import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationType, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelRegistry } from '../automation/channel.providers';
import { LoginDto, ForgotPasswordDto, PasswordResetDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { hashToken, generateOtpCode, hashOtp, verifyOtpHash } from './otp.util';
import { PASSWORD_MAX_LENGTH, PASSWORD_PATTERN, PASSWORD_REQUIREMENTS_MESSAGE } from './password.util';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const PASSWORD_RESET_TTL_SECONDS = 900;
const PASSWORD_RESET_SCOPE = 'password_reset';

type UserWithOrganization = User & { organization: any | null };

export interface SessionMeta {
  deviceInfo?: string;
  ip?: string;
}

const ORGANIZATION_TYPE_BY_ROLE: Record<string, OrganizationType | undefined> = {
  UNIVERSITY_OFFICER: OrganizationType.UNIVERSITY,
  LOAN_OFFICER: OrganizationType.BANK,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private channels: ChannelRegistry
  ) {}

  private async recordLoginEvent(data: { email: string; outcome: 'SUCCESS' | 'FAILED' | 'LOCKED'; userId?: string; role?: Role; meta?: SessionMeta }) {
    try {
      await this.prisma.loginEvent.create({
        data: {
          email: data.email || 'unknown',
          outcome: data.outcome,
          userId: data.userId,
          role: data.role,
          ip: data.meta?.ip,
          userAgent: data.meta?.deviceInfo
        }
      });
    } catch {
      // logging is best-effort
    }
  }

  async sendRegistrationOtp(email: string, fullName: string) {
    const code = generateOtpCode();
    // Using a generic secret here just for HMAC, normally comes from config
    const otpHash = hashOtp(code, this.config.get('JWT_SECRET') || 'supersecret');
    
    const token = this.jwt.sign(
      { email, fullName, otpHash, scope: 'register_otp' },
      { expiresIn: '15m' }
    );

    const emailProvider = this.channels.get('email');
    if (emailProvider && emailProvider.available()) {
      await emailProvider.send({
        to: { email, name: fullName } as any,
        subject: 'Verify your SuperOffer account',
        body: `Your registration OTP is ${code}. It expires in 15 minutes.`
      });
    } else {
      this.logger.warn(`Mock Email Registration OTP for ${email}: ${code}`);
      const fs = require('fs');
      try {
        fs.appendFileSync('.dev-otp.log', `${new Date().toISOString()}  REGISTRATION OTP FOR ${email}: ${code}\n`);
      } catch {}
    }

    return { token };
  }

  async register(dto: RegisterDto) {
    const email = String(dto.email).trim().toLowerCase();
    
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const role = dto.role as Role;


    if (role === 'STUDENT') {
      if (!dto.token || !dto.otp) {
        throw new BadRequestException({ code: 'OTP_REQUIRED', message: 'OTP is required for student registration' });
      }

      try {
        const payload = this.jwt.verify(dto.token);
        if (payload.scope !== 'register_otp' || payload.email !== email) {
          throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid registration token' });
        }
        
        if (!verifyOtpHash(dto.otp, payload.otpHash, this.config.get('JWT_SECRET') || 'supersecret')) {
          throw new UnauthorizedException({ code: 'INVALID_OTP', message: 'Incorrect OTP' });
        }
      } catch {
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'OTP verification failed or expired' });
      }

      const student = await this.prisma.$transaction(async tx => {
        const created = await tx.user.create({ 
          data: { 
            email, 
            passwordHash, 
            fullName: dto.fullName, 
            role: Role.STUDENT,
            emailVerifiedAt: new Date()
          } 
        });
        await tx.studentProfile.create({ data: { userId: created.id } });
        return created;
      });

      return {
        user_id: student.id,
        role: student.role,
        can_login: true
      };
    }

    const organizationType = ORGANIZATION_TYPE_BY_ROLE[role];
    if (!organizationType) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'The selected role cannot be registered' });
    }
    if (!dto.organization?.name) {
      throw new BadRequestException({ code: 'ORGANIZATION_REQUIRED', message: 'Institution accounts must include organization details' });
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
      can_login: user.organization?.verificationStatus !== 'REJECTED'
    };
  }

  async login(dto: LoginDto, meta: SessionMeta = {}) {
    const identifier = dto.identifier.trim().toLowerCase();

    const user = (await this.prisma.user.findUnique({
      where: { email: identifier },
      include: { organization: true }
    })) as UserWithOrganization | null;

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

    if (user.organization) {
      if (user.organization.verificationStatus === 'PENDING') {
        throw new HttpException(
          { code: 'ACCOUNT_PENDING_APPROVAL', message: 'Your organization registration is pending Super Admin approval', user_id: user.id, approval_status: 'PENDING' },
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

    await this.recordLoginEvent({ email: identifier, outcome: 'SUCCESS', userId: user.id, role: user.role, meta });
    return this.issueTokens(updated, meta);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No account found for this session' });

    return {
      user_id: user.id,
      role: user.role,
      full_name: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      email_verified: Boolean(user.emailVerifiedAt),
      phone_verified: Boolean(user.phoneVerifiedAt),
      password_changed_at: user.passwordChangedAt?.toISOString() || null,
      organization: user.organization
        ? {
            name: user.organization.name,
            organizationType: user.organization.organizationType,
            registrationNumber: user.organization.registrationNumber,
            licenseReference: user.organization.licenseReference,
            website: user.organization.website,
            country: user.organization.country,
            city: user.organization.city,
            approval_status: user.organization.verificationStatus
          }
        : null
    };
  }

  async updateAccount(userId: string, dto: { fullName?: string; email?: string }) {
    const data: any = {};
    if (dto.fullName) data.fullName = dto.fullName.trim();
    
    const user = await this.prisma.user.update({
      where: { id: userId },
      data
    });
    return { updated: true };
  }

  async logout(sessionId: string) {
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() }
    });
    return { logged_out: true };
  }

  async changePassword(userId: string, current: string, next: string, sessionId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });

    const valid = await bcrypt.compare(current, user.passwordHash);
    if (!valid) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 12), passwordChangedAt: new Date() }
    });

    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date() }
    });

    return { password_changed: true, other_sessions_revoked: true };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user) throw new NotFoundException();
    return {
      locked: user.lockedUntil && user.lockedUntil > new Date(),
      approval_status: user.organization?.verificationStatus
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    
    if (!user) return { requested: true };

    const resetToken = this.jwt.sign(
      { sub: user.id, email: user.email, scope: PASSWORD_RESET_SCOPE, hashPrefix: user.passwordHash?.slice(0, 10) },
      { expiresIn: PASSWORD_RESET_TTL_SECONDS }
    );

    const emailProvider = this.channels.get('email');
    if (emailProvider && emailProvider.available()) {
      const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:4200';
      const portal = user.role === 'STUDENT' ? 'student' : 'organization';
      const url = `${frontendUrl}/auth/reset/${portal}?token=${resetToken}`;
      
      await emailProvider.send({
        to: { email: user.email!, name: user.fullName || 'User' } as any,
        subject: 'Reset your SuperOffer password',
        body: `You requested a password reset. Click the following link to set a new password: ${url}`
      });
    } else {
      this.logger.warn(`Mock Email Password Reset for ${email}: Token ${resetToken}`);
      // Fallback for dev: log it to the OTP log for easy reading
      const fs = require('fs');
      try {
        fs.appendFileSync('.dev-otp.log', `${new Date().toISOString()}  RESET LINK FOR ${email}: http://localhost:4200/auth/reset/${user.role.toLowerCase()}?token=${resetToken}\n`);
      } catch {}
    }

    return { requested: true };
  }

  async resetPassword(dto: PasswordResetDto) {
    let claims: { sub?: string; scope?: string };
    try {
      claims = this.jwt.verify(dto.resetToken);
    } catch {
      throw new UnauthorizedException({
        code: 'RESET_TOKEN_INVALID',
        message: 'This reset link has expired, request a new link'
      });
    }
    if (claims.scope !== PASSWORD_RESET_SCOPE || !claims.sub) {
      throw new UnauthorizedException({ code: 'RESET_TOKEN_INVALID', message: 'This reset token cannot be used' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No account found' });
    
    // Invalidate if the password changed since the token was issued
    if ((claims as any).hashPrefix && user.passwordHash && !user.passwordHash.startsWith((claims as any).hashPrefix)) {
      throw new UnauthorizedException({ code: 'RESET_TOKEN_INVALID', message: 'This reset link has expired, request a new link' });
    }

    const updateResult = await this.prisma.user.updateMany({
      where: { 
        id: user.id,
        passwordHash: user.passwordHash
      },
      data: {
        passwordHash: await bcrypt.hash(dto.password, 12),
        passwordChangedAt: new Date(),
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    if (updateResult.count === 0) {
      throw new UnauthorizedException({ code: 'RESET_TOKEN_INVALID', message: 'This reset link has expired, request a new link' });
    }

    await this.prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return { reset: true };
  }

  private async issueTokens(user: UserWithOrganization, meta: SessionMeta) {
    const accessTtl = Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS')) || 3600;
    const refreshTtl = Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS')) || 2_592_000;

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
