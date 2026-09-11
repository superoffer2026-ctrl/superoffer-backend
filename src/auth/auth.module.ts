import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GallaboxWhatsAppSender, MetaWhatsAppSender, MockWhatsAppSender, WHATSAPP_SENDER } from './whatsapp-sender';

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
      /**
       * Whichever provider is configured wins; with none configured the mock
       * logs the code so local development needs no WhatsApp account at all.
       * Gallabox is checked first because it is the intended production sender.
       */
      useFactory: (config: ConfigService) => {
        const gallaboxApiKey = config.get<string>('GALLABOX_API_KEY');
        const gallaboxApiSecret = config.get<string>('GALLABOX_API_SECRET');
        const gallaboxChannelId = config.get<string>('GALLABOX_CHANNEL_ID');
        if (gallaboxApiKey && gallaboxApiSecret && gallaboxChannelId) {
          return new GallaboxWhatsAppSender({
            apiKey: gallaboxApiKey,
            apiSecret: gallaboxApiSecret,
            channelId: gallaboxChannelId,
            templateName: config.get<string>('GALLABOX_OTP_TEMPLATE_NAME'),
            bodyVariableName: config.get<string>('GALLABOX_OTP_BODY_VARIABLE'),
            baseUrl: config.get<string>('GALLABOX_BASE_URL')
          });
        }

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
