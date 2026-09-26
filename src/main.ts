import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  /**
   * The portal and the API sit on different hosts, so a browser preflights
   * before most calls. Without a max-age it re-asks permission every time,
   * which doubles the request count on pages that poll for unread messages.
   * Two hours is the ceiling Chrome honours; browsers cap it themselves.
   */
  app.enableCors({ origin: corsOrigins, credentials: true, maxAge: 7200 });

  app.setGlobalPrefix('api/v1', {
    exclude: ['/', 'health'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SuperOffer API')
    .setDescription('Student profile & activity endpoints')
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`SuperOffer API listening on http://${host}:${port}/api/v1`);
}

bootstrap();
