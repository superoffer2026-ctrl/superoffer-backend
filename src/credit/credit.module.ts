import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module';
import { BureauCredentialController } from './bureau-credential.controller';
import { BureauCredentialService } from './bureau-credential.service';
import { OrganizationCreditController, StudentCreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { CREDIT_BUREAU } from './credit.types';
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
  providers: [
    CreditService,
    /** SurePass in every environment; sandbox and live differ only by SUREPASS_BASE_URL and SUREPASS_TOKEN. */
    { provide: CREDIT_BUREAU, useClass: SurePassProvider },
    BureauCredentialService,
    FileSecretStore
  ],
  exports: [CreditService]
})
export class CreditModule {}
