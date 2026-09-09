import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module';
import { BureauCredentialController } from './bureau-credential.controller';
import { BureauCredentialService } from './bureau-credential.service';
import { OrganizationCreditController, StudentCreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { FileSecretStore } from './secret-store';
import { SurePassProvider } from './surepass.provider';

/**
 * The co-applicant, the consent that permits a credit look-up, and the look-up
 * itself.
 *
 * The provider is bound here rather than in the service, so the connector can be
 * replaced without touching the consent, audit or eligibility code around it.
 */
@Module({
  imports: [FormsModule],
  controllers: [StudentCreditController, OrganizationCreditController, BureauCredentialController],
  providers: [CreditService, SurePassProvider, BureauCredentialService, FileSecretStore],
  exports: [CreditService]
})
export class CreditModule {}
