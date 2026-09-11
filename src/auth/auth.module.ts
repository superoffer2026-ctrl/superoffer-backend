import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { resolveWhatsAppSender, WHATSAPP_SENDER } from './whatsapp-sender';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('AUTH_TOKEN_SECRET') || 'development-only-secret-change-before-deploying'
      })
    })
  ],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: WHATSAPP_SENDER,
      /** Chosen from the environment alone — see `resolveWhatsAppSender`. */
      useFactory: (config: ConfigService) => resolveWhatsAppSender(config),
      inject: [ConfigService]
    }
  ],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
