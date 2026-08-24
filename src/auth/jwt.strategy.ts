import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  /** The auth session this token was issued for. */
  sid?: string;
  email?: string;
  phone?: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('AUTH_TOKEN_SECRET') || 'development-only-secret-change-before-deploying'
    });
  }

  /**
   * A valid signature is not enough: the session it was issued for must still be
   * live. This is what makes "sign out" and "changing your password signs out
   * your other devices" actually true, at the cost of one indexed lookup per
   * request. Tokens minted before sessions were linked carry no `sid` and are
   * rejected.
   */
  async validate(payload: JwtPayload) {
    if (!payload.sid) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Please sign in again' });
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, userId: true }
    });

    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Your session has ended. Please sign in again.' });
    }

    return { id: payload.sub, sessionId: payload.sid, email: payload.email, phone: payload.phone, role: payload.role };
  }
}
