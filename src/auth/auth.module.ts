import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { MetaWhatsAppSender, MockWhatsAppSender, WHATSAPP_SENDER } from './whatsapp-sender';

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
      useFactory: (config: ConfigService) => {
        const accessToken = config.get<string>('WHATSAPP_ACCESS_TOKEN');
        const phoneNumberId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
        if (accessToken && phoneNumberId) {
          return new MetaWhatsAppSender({
            accessToken,
            phoneNumberId,
            apiVersion: config.get<string>('WHATSAPP_API_VERSION'),
            templateName: config.get<string>('WHATSAPP_OTP_TEMPLATE_NAME'),
            languageCode: config.get<string>('WHATSAPP_OTP_TEMPLATE_LANGUAGE')
          });
        }
        return new MockWhatsAppSender();
      },
      inject: [ConfigService]
    }
  ],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
