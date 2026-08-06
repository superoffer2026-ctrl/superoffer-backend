import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; lockedUntil: number | null }>();

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const role = dto.role || 'STUDENT';

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        ...(role === 'STUDENT' ? { studentProfile: { create: {} } } : {})
      }
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const lock = failedAttempts.get(email);
    if (lock?.lockedUntil && lock.lockedUntil > Date.now()) {
      throw new UnauthorizedException('Too many failed attempts. Try again later.');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;

    if (!user || !valid) {
      const next = { count: (lock?.count || 0) + 1, lockedUntil: null as number | null };
      if (next.count >= MAX_FAILED_ATTEMPTS) next.lockedUntil = Date.now() + LOCK_DURATION_MS;
      failedAttempts.set(email, next);
      throw new UnauthorizedException('Invalid email or password');
    }

    failedAttempts.delete(email);
    return this.issueTokens(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
  }

  private issueTokens(user: { id: string; email: string; role: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessTtl = Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS')) || 3600;
    const refreshTtl = Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS')) || 2_592_000;

    return {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken: this.jwt.sign(payload, { expiresIn: accessTtl }),
      refreshToken: this.jwt.sign(payload, { expiresIn: refreshTtl })
    };
  }
}
