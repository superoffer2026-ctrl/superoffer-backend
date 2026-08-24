import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from './automation/automation.module';
import { CreditModule } from './credit/credit.module';
import { FormsModule } from './forms/forms.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { StudentsModule } from './students/students.module';
import { DocumentsModule } from './documents/documents.module';
import { ReferenceModule } from './reference/reference.module';
import { OffersModule } from './offers/offers.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CreditModule,
    FormsModule,
    AutomationModule,
    AuthModule,
    AdminModule,
    StudentsModule,
    DocumentsModule,
    ReferenceModule,
    OffersModule,
    OrganizationsModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
