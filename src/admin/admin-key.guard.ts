import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-admin-key'];
    const expected = this.config.get<string>('ADMIN_APPROVAL_KEY') || 'development-admin-key';
    if (!provided || provided !== expected) {
      throw new UnauthorizedException({ code: 'ADMIN_UNAUTHORIZED', message: 'A valid admin approval key is required' });
    }
    return true;
  }
}
